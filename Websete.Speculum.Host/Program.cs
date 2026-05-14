using Websete.Speculum.Browser;
using Websete.Speculum.Host.Hubs;
using Websete.Speculum.Host.Services;
using Websete.Speculum.Host.Ws;

var builder = WebApplication.CreateBuilder(args);

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

// ── Shutdown: dispose all sidecar connections gracefully ──────────────────────
var sidecarService = app.Services.GetRequiredService<SidecarService>();
app.Lifetime.ApplicationStopping.Register(() =>
    sidecarService.DisposeAsync().AsTask().GetAwaiter().GetResult());

// ── Pipeline ──────────────────────────────────────────────────────────────────
// WebSocket support must come before routing so the upgrade happens correctly.
app.UseWebSockets(new WebSocketOptions
{
    // Generous timeout — sessions can be long-lived.
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
