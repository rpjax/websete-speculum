using Websete.Speculum.Browser;
using Websete.Speculum.Host;
using Websete.Speculum.Host.Hubs;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<BrowserService>();
builder.Services.AddSingleton<SessionRegistry>();
builder.Services.AddControllers();

// SignalR is the exclusive signaling channel for WebRTC session management.
// The old raw-WebSocket endpoint is gone — all offer/answer/ICE flows through the hub.
builder.Services.AddSignalR();

var app = builder.Build();

var browserService = app.Services.GetRequiredService<BrowserService>();
var camoufoxPath   = app.Configuration["Camoufox:ExecutablePath"]
    ?? throw new InvalidOperationException(
           "Camoufox:ExecutablePath is not configured. " +
           "Set it in appsettings.json or via the Camoufox__ExecutablePath environment variable.");

await browserService.InitializeAsync(camoufoxPath);

app.Lifetime.ApplicationStopping.Register(() =>
    browserService.DisposeAsync().AsTask().GetAwaiter().GetResult());

app.UseDefaultFiles();
app.UseStaticFiles();
app.MapControllers();

// ── SignalR hub ───────────────────────────────────────────────────────────────
app.MapHub<VirtualizationHub>("/hub/virtualization");

app.Run();
