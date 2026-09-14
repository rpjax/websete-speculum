using System.Net.Mime;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Speculum.Lab;
using Speculum.Lab.Upstream;
using Speculum.Lab.Session;
using Speculum.Lab.Web;

var options = LabOptions.FromEnvironment();

var builder = WebApplication.CreateBuilder(args);
builder.Logging.AddSimpleConsole(c => c.SingleLine = true);
builder.WebHost.ConfigureKestrel(k => k.Listen(
    System.Net.IPAddress.Parse(options.Host == "0.0.0.0" ? "0.0.0.0" : options.Host),
    options.Port));

builder.Services.AddSingleton(options);
builder.Services.AddSingleton<SupervisorClient>();
builder.Services.AddSingleton<SessionHost>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<SupervisorClient>());

var app = builder.Build();
app.UseWebSockets();

var upstream = app.Services.GetRequiredService<SupervisorClient>();
var sessions = app.Services.GetRequiredService<SessionHost>();
var loggerFactory = app.Services.GetRequiredService<ILoggerFactory>();
var sessionLogger = loggerFactory.CreateLogger("lab.session");
var liveSessions = new System.Collections.Concurrent.ConcurrentDictionary<string, LabSessionConnection>();

// ---------------------------------------------------------------------------
// Cliente projetado. Servido a partir do lab TypeScript existente — o mesmo
// artefato, sem cópia e sem fork.
// ---------------------------------------------------------------------------

app.MapGet("/", () => ServeStatic(options.StaticDirectory, "client.html", MediaTypeNames.Text.Html));
app.MapGet("/index.html", () => ServeStatic(options.StaticDirectory, "client.html", MediaTypeNames.Text.Html));
app.MapGet("/client.js", () => ServeStatic(options.StaticDirectory, "client.js", "text/javascript"));
app.MapGet("/lab/client.js", () => ServeStatic(options.StaticDirectory, "client.js", "text/javascript"));

app.MapGet("/fixtures/{**path}", (string path) => ServeStatic(options.FixturesDirectory, path, null));

app.MapGet("/lab/fixtures", () =>
{
    var manifest = Path.Combine(options.FixturesDirectory, "manifest.json");
    return File.Exists(manifest)
        ? Results.File(manifest, MediaTypeNames.Application.Json)
        : Results.Json(new { fixtures = Array.Empty<object>() });
});

app.MapGet("/lab/blueprints", () => Results.Json(new { blueprints = Array.Empty<object>() }));

// Painel de runs do cliente. O runner de blueprints é fase F5; até lá a listagem
// é vazia — mas o endpoint existe, porque 404 aqui é erro visível no console.
app.MapGet("/lab/runs", () => Results.Json(new { runs = Array.Empty<object>() }));
app.MapGet("/lab/runs/{id}", () => Results.NotFound());

// O navegador pede sempre; 404 aqui só suja o console de quem está depurando.
app.MapGet("/favicon.ico", () => Results.NoContent());

// Diagnóstico do F1 em um GET. Quem responde "chegou frame?" é a ferramenta,
// não a pessoa olhando a tela.
app.MapGet("/lab/health", () => Results.Json(new
{
    ok = true,
    protocolVersion = Speculum.Lab.Protocol.LabProtocol.Version,
    supervisor = upstream.Connected ? "connected" : "disconnected",
    sessionRunning = sessions.Running,
    framesFromSupervisor = upstream.FramesReceived,
    bytesFromSupervisor = upstream.BytesReceived,
    sessions = liveSessions.Values.Select(s => new
    {
        id = s.Id,
        streaming = s.Streaming,
        framesForwarded = s.FramesForwarded,
    }).ToArray(),
}));

app.MapGet("/lab/config.json", () => Results.Json(new { crossOriginOrigin = (string?)null }));

// ---------------------------------------------------------------------------
// Plano de controle + frames para a aba aberta no navegador.
// ---------------------------------------------------------------------------

app.Map("/lab/session", async (HttpContext context) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    var session = new LabSessionConnection(socket, upstream, sessions, sessionLogger);
    liveSessions[session.Id] = session;
    sessionLogger.LogInformation("sessão {Id} aberta", session.Id);
    try
    {
        await session.RunAsync(context.RequestAborted);
    }
    finally
    {
        liveSessions.TryRemove(session.Id, out _);
        sessionLogger.LogInformation(
            "sessão {Id} encerrada — {Frames} frames encaminhados", session.Id, session.FramesForwarded);
    }
});

WarnIfMissing(app.Logger, options);
app.Logger.LogInformation("lab: http://{Host}:{Port}/  · supervisor {Uri}", options.Host, options.Port, options.SupervisorUri);

app.Run();

static IResult ServeStatic(string root, string relative, string? contentType)
{
    var full = Path.GetFullPath(Path.Combine(root, relative));
    if (!full.StartsWith(Path.GetFullPath(root), StringComparison.Ordinal) || !File.Exists(full))
    {
        return Results.NotFound();
    }

    return contentType is null ? Results.File(full) : Results.File(full, contentType);
}

static void WarnIfMissing(ILogger logger, LabOptions options)
{
    if (!File.Exists(Path.Combine(options.StaticDirectory, "client.html")))
    {
        logger.LogError(
            "client.html não encontrado em {Dir}. O lab serve o cliente do lab TypeScript; "
            + "rode `npm run build:*` no sidecar ou aponte SPECULUM_LAB_STATIC.",
            options.StaticDirectory);
    }
}
