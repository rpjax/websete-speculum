using System.Net;
using Websete.Speculum.Browser;
using Websete.Speculum.Host.Certs;
using Websete.Speculum.Host.Config;
using Websete.Speculum.Host.Rewriting;
using Websete.Speculum.Host.ScriptInjection;
using Websete.Speculum.Host.Virtualization.Services;
using Websete.Speculum.Host.Virtualization.Ws;

var builder = WebApplication.CreateBuilder(args);

// ── Configuration ─────────────────────────────────────────────────────────────
var speculumConfig = SpeculumConfig.Load(builder.Configuration, builder.Environment.WebRootPath);
builder.Services.AddSingleton(speculumConfig);

// ── Certificates ──────────────────────────────────────────────────────────────
var certBasePath = builder.Configuration["CertificatesPath"]
    ?? Path.Combine(AppContext.BaseDirectory, "Certificates");
var certLoader = CertificateProvider.Create(speculumConfig, certBasePath);
builder.Services.AddSingleton<ICertificateProvider>(certLoader);

// ── Kestrel: HTTP/1.1 + HTTP/2 + HTTP/3 on the same port ─────────────────────
// HTTP/3 runs over QUIC (UDP). Same TLS config as HTTP/1.1+2.
// Kestrel automatically advertises HTTP/3 via Alt-Svc response headers.
if (!IPEndPoint.TryParse(speculumConfig.HttpAddress, out var listenEndpoint))
    throw new InvalidOperationException(
        $"Invalid HttpAddress '{speculumConfig.HttpAddress}'.");

builder.WebHost.ConfigureKestrel(kestrel =>
{
    kestrel.Listen(listenEndpoint.Address, listenEndpoint.Port, listen =>
    {
        listen.Protocols = Microsoft.AspNetCore.Server.Kestrel.Core.HttpProtocols.Http1AndHttp2;
        listen.UseHttps(https =>
        {
            https.ServerCertificateSelector = (_, serverName) =>
                string.IsNullOrEmpty(serverName)
                    ? certLoader.GetDefaultCertificate()
                    : certLoader.GetCertificate(serverName);
        });
    });
});

// ── Services ──────────────────────────────────────────────────────────────────
builder.Services.AddSingleton<IUrlRewriter, UrlRewriter>();
builder.Services.AddSingleton<ScriptInjectionService>();

builder.Services.AddSingleton<SidecarService>(sp =>
{
    var config  = sp.GetRequiredService<IConfiguration>();
    var baseUrl = config["Sidecar:BaseUrl"]
        ?? throw new InvalidOperationException("Sidecar:BaseUrl is not configured.");
    return new SidecarService { SidecarBaseUrl = baseUrl };
});

builder.Services.AddSingleton<IVirtualizationService, VirtualizationService>();
builder.Services.AddControllers();

var app = builder.Build();

// ── Eager singleton resolution ────────────────────────────────────────────────
app.Services.GetRequiredService<ScriptInjectionService>();

// ── Shutdown ──────────────────────────────────────────────────────────────────
var sidecarService = app.Services.GetRequiredService<SidecarService>();
app.Lifetime.ApplicationStopping.Register(() =>
{
    Task.Run(() => sidecarService.DisposeAsync().AsTask()).GetAwaiter().GetResult();
});
app.Lifetime.ApplicationStopped.Register(() => certLoader.Dispose());

// ── Pipeline ──────────────────────────────────────────────────────────────────
app.UseWebSockets();          // enables WS upgrade on any endpoint

app.UseDefaultFiles();

// Serve static files but tell browsers never to cache index.html so a
// new deployment is always picked up without a hard refresh.
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

app.MapControllers();

// ── REST API: session lifecycle ───────────────────────────────────────────────

// POST /api/sessions — create a new browser session, return session metadata.
// The client then opens a WebTransport connection to /wt/{sessionId}.
app.MapPost("/api/sessions", async (
    HttpContext            httpCtx,
    IVirtualizationService service,
    ILogger<Program>       logger) =>
{
    CreateSessionRequest? req;
    try   { req = await httpCtx.Request.ReadFromJsonAsync<CreateSessionRequest>(); }
    catch { req = null; }
    req ??= new CreateSessionRequest();

    try
    {
        var resp = await service.CreateSessionAsync(req);
        return Results.Json(resp);
    }
    catch (InvalidOperationException ex)
    {
        logger.LogWarning("Session creation failed: {Msg}", ex.Message);
        return Results.Problem(ex.Message, statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});

// DELETE /api/sessions/{id} — explicitly close a session.
app.MapDelete("/api/sessions/{sessionId}", async (
    string                 sessionId,
    IVirtualizationService service) =>
{
    await service.CloseSessionAsync(sessionId);
    return Results.NoContent();
});

// ── WebSocket: one connection per session ─────────────────────────────────────
// Bidirectional binary WebSocket on wss:// (TCP).  The same H.264 binary
// protocol runs over this channel — type byte multiplexes video/control/input.
app.Map("/ws/{sessionId}", async (HttpContext context, IVirtualizationService service) =>
{
    var logger = context.RequestServices
        .GetRequiredService<ILoggerFactory>()
        .CreateLogger(nameof(WebSocketSessionHandler));

    await WebSocketSessionHandler.HandleAsync(context, service, logger);
});

app.Run();
