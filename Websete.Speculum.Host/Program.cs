using System.Net;
using Websete.Speculum.Host.Certs;
using Websete.Speculum.Host.Config;
using Websete.Speculum.Host.Virtualization;
using Websete.Speculum.Host.Virtualization.Contracts;
using Websete.Speculum.Host.Virtualization.Options;
using Websete.Speculum.Host.Virtualization.Presentation;

var builder = WebApplication.CreateBuilder(args);

// ── Configuration ─────────────────────────────────────────────────────────────
var speculumConfig = SpeculumConfig.Load(builder.Configuration, builder.Environment.WebRootPath);

// ── Certificates ──────────────────────────────────────────────────────────────
var certBasePath = builder.Configuration["CertificatesPath"]
    ?? Path.Combine(AppContext.BaseDirectory, "Certificates");
var certLoader = CertificateProvider.Create(speculumConfig, certBasePath);
builder.Services.AddSingleton<ICertificateProvider>(certLoader);

// ── Kestrel ───────────────────────────────────────────────────────────────────
if (!IPEndPoint.TryParse(speculumConfig.HttpAddress, out var listenEndpoint))
    throw new InvalidOperationException(
        $"Invalid HttpAddress '{speculumConfig.HttpAddress}'.");

builder.WebHost.ConfigureKestrel(kestrel =>
{
    kestrel.Listen(listenEndpoint.Address, listenEndpoint.Port, listen =>
    {
        listen.Protocols = Microsoft.AspNetCore.Server.Kestrel.Core.HttpProtocols.Http1AndHttp2AndHttp3;
        listen.UseHttps(https =>
        {
            https.ServerCertificateSelector = (_, serverName) =>
                string.IsNullOrEmpty(serverName)
                    ? certLoader.GetDefaultCertificate()
                    : certLoader.GetCertificate(serverName);
        });
    });
});

// ── Virtualization services ───────────────────────────────────────────────────
builder.Services.AddSingleton(sp =>
{
    var cfg = sp.GetRequiredService<IConfiguration>();
    return new SidecarBrowserClientOptions
    {
        SidecarBaseUrl = cfg["Sidecar:BaseUrl"]
            ?? throw new InvalidOperationException("Sidecar:BaseUrl is not configured."),
    };
});

builder.Services.AddSingleton(sp =>
{
    var cfg = sp.GetRequiredService<IConfiguration>();
    return new VirtualBrowserConnectionOptions
    {
        Width           = cfg.GetValue("Browser:Width",  1280),
        Height          = cfg.GetValue("Browser:Height", 720),
        InitialUrl      = cfg["Browser:InitialUrl"],
        JsBridgeEnabled = cfg.GetValue("Browser:JsBridgeEnabled", false),
    };
});

// Sessions are per-connection: VSessionRegistry is singleton, keyed by ConnectionId.
// The hub (transient) creates/looks up sessions via the registry.
// Cleanup happens in VirtualizationHub.OnDisconnectedAsync.
builder.Services.AddSingleton<IVSessionRegistry, VSessionRegistry>();

// ── SignalR ───────────────────────────────────────────────────────────────────
builder.Services.AddSignalR();

var app = builder.Build();

// ── Shutdown ──────────────────────────────────────────────────────────────────
app.Lifetime.ApplicationStopped.Register(() => certLoader.Dispose());

// ── Pipeline ──────────────────────────────────────────────────────────────────
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        if (ctx.File.Name.Equals("index.html", StringComparison.OrdinalIgnoreCase))
        {
            ctx.Context.Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
            ctx.Context.Response.Headers["Pragma"]        = "no-cache";
        }
    },
});

app.MapHub<VirtualizationHub>("/vhub");

// Every unmatched route serves index.html — the virtual browser is the app.
app.MapFallbackToFile("index.html");

app.Run();
