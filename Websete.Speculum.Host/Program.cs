using System.Net;
using Websete.Speculum.Host.Certs;
using Websete.Speculum.Host.Config;
using Websete.Speculum.Host.Virtualization;
using Websete.Speculum.Host.Virtualization.Contracts;
using Websete.Speculum.Host.Virtualization.Options;
using Websete.Speculum.Host.Virtualization.Presentation;
using Websete.Speculum.Host.Virtualization.Sidecar;

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

// ── VirtualBrowserConnectionOptions ──────────────────────────────────────────
// JsBridgeEnabled and Scripts come from SpeculumConfig (JsBridge:Enable and
// ScriptInjection sections).  Width/Height/InitialUrl use dedicated Browser:*
// keys for per-deploy overrides.
//
// Script file content is read once at startup from wwwroot so the sidecar
// never needs file-system access to the host.  Files that do not exist on
// disk are skipped with a warning (SpeculumConfigValidator already enforced
// existence in Production; this guard covers hot-reload in Development).
builder.Services.AddSingleton(sp =>
{
    var cfg      = sp.GetRequiredService<IConfiguration>();
    var webRoot  = builder.Environment.WebRootPath;
    var logger   = sp.GetRequiredService<ILogger<Program>>();

    var scripts = speculumConfig.ScriptInjection
        .Select(entry =>
        {
            var physical = Path.Combine(
                webRoot,
                entry.File.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));

            if (!File.Exists(physical))
            {
                logger.LogWarning(
                    "ScriptInjection: file '{File}' not found at '{Physical}' — skipping.",
                    entry.File, physical);
                return null;
            }

            var content = File.ReadAllText(physical);
            return new ScriptPayload(entry.Position, entry.Type, entry.File, content);
        })
        .Where(p => p is not null)
        .Cast<ScriptPayload>()
        .ToList();

    if (scripts.Count > 0)
        logger.LogInformation("ScriptInjection: {Count} script(s) will be injected into every virtual page.", scripts.Count);

    return new VirtualBrowserConnectionOptions
    {
        Width           = cfg.GetValue("Browser:Width",  1280),
        Height          = cfg.GetValue("Browser:Height", 720),
        InitialUrl      = cfg["Browser:InitialUrl"],
        // JsBridgeEnabled comes from JsBridge:Enable (SpeculumConfig), NOT Browser:JsBridgeEnabled.
        // Browser:JsBridgeEnabled was a dead key — the config has always used the JsBridge section.
        JsBridgeEnabled = speculumConfig.JsBridge.Enable,
        Scripts         = scripts,
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
