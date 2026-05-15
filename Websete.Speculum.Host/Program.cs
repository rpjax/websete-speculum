using System.Net;
using Websete.Speculum.Browser;
using Websete.Speculum.Host.Certs;
using Websete.Speculum.Host.Config;
using Websete.Speculum.Host.Rewriting;
using Websete.Speculum.Host.Virtualization.Hubs;
using Websete.Speculum.Host.Virtualization.Services;
using Websete.Speculum.Host.Virtualization.Ws;

var builder = WebApplication.CreateBuilder(args);

// ── Configuration snapshot ────────────────────────────────────────────────────
var speculumConfig = SpeculumConfig.Load(builder.Configuration);
builder.Services.AddSingleton(speculumConfig);

// ── Certificates (fail-fast: every profile must have a cert) ──────────────────
// Layout: {certBasePath}/{domain}/privkey.pem
//         {certBasePath}/{domain}/fullchain.pem
// Override CertificatesPath in appsettings or via environment variable to
// point at the correct root in Docker (/Certificates) vs development.
var certBasePath = builder.Configuration["CertificatesPath"]
    ?? Path.Combine(builder.Environment.ContentRootPath, "Certificates");

var certLoader = CertificateProvider.Create(speculumConfig, certBasePath);
builder.Services.AddSingleton<ICertificateProvider>(certLoader);

// ── Kestrel: HTTPS listener with per-domain certificate selection (SNI) ────────
// HttpAddress from config (e.g. "0.0.0.0:443") is parsed into an IPEndPoint.
// Kestrel's ServerCertificateSelector fires per-TLS-connection with the SNI
// server name; we delegate to ICertificateProvider which was pre-loaded above.
if (!IPEndPoint.TryParse(speculumConfig.HttpAddress, out var listenEndpoint))
    throw new InvalidOperationException(
        $"Invalid HttpAddress '{speculumConfig.HttpAddress}'. " +
        "Expected host:port format, e.g. '0.0.0.0:443'.");

builder.WebHost.ConfigureKestrel(kestrel =>
{
    kestrel.Listen(listenEndpoint.Address, listenEndpoint.Port, listen =>
    {
        listen.UseHttps(https =>
        {
            // certLoader is captured here (before builder.Build()) and is
            // safe to use in the selector because it is fully initialised
            // and immutable at this point.
            https.ServerCertificateSelector = (_, serverName) =>
                string.IsNullOrEmpty(serverName)
                    ? certLoader.GetDefaultCertificate()
                    : certLoader.GetCertificate(serverName);
        });
    });
});

// ── URL rewriting (MITM forwarding rules) ─────────────────────────────────────
builder.Services.AddSingleton<IUrlRewriter, UrlRewriter>();

// ── Sidecar service ───────────────────────────────────────────────────────────
// SidecarService manages WebSocket connections to the Node.js sidecar.
// The BaseUrl is configured via appsettings or environment variable
// (Sidecar__BaseUrl=ws://sidecar:3000 in docker-compose).
builder.Services.AddSingleton<SidecarService>(sp =>
{
    var config  = sp.GetRequiredService<IConfiguration>();
    var baseUrl = config["Sidecar:BaseUrl"]
        ?? throw new InvalidOperationException(
               "Sidecar:BaseUrl is not configured. " +
               "Set it via appsettings.json or the Sidecar__BaseUrl environment variable.");

    return new SidecarService { SidecarBaseUrl = baseUrl };
});

// ── Domain services ───────────────────────────────────────────────────────────
builder.Services.AddSingleton<IVirtualizationService, VirtualizationService>();

// ── ASP.NET Core ──────────────────────────────────────────────────────────────
builder.Services.AddControllers();
builder.Services.AddSignalR();

var app = builder.Build();

// ── Shutdown ──────────────────────────────────────────────────────────────────
var sidecarService = app.Services.GetRequiredService<SidecarService>();
app.Lifetime.ApplicationStopping.Register(() =>
{
    // Run on the thread pool to avoid any potential sync-context deadlock.
    // GetAwaiter().GetResult() then blocks until disposal completes so that
    // the host does not exit before all sidecar connections are closed.
    Task.Run(() => sidecarService.DisposeAsync().AsTask())
        .GetAwaiter()
        .GetResult();
});

// Release X509 certificate resources on shutdown.
app.Lifetime.ApplicationStopped.Register(() => certLoader.Dispose());

// ── Pipeline ──────────────────────────────────────────────────────────────────
// WebSocket support must come before routing so the upgrade happens correctly.
app.UseWebSockets(new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromSeconds(30),
});

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapControllers();

// Binary WebSocket endpoint: one connection per browser session.
// ClientWebSocketHandler relays frames (sidecar → client) and input (client → sidecar).
app.Map("/ws/{sessionId}", ClientWebSocketHandler.HandleAsync);

app.MapHub<VirtualizationHub>("/hub/virtualization");

app.Run();
