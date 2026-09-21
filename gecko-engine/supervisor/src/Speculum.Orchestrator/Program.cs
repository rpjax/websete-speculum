using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Speculum.Orchestrator;

var options = OrchestratorOptions.FromEnvironment();

var builder = WebApplication.CreateSlimBuilder(args);
builder.Logging.AddSimpleConsole(c => c.SingleLine = true);
builder.WebHost.ConfigureKestrel(k => k.ListenAnyIP(options.ListenPort));
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.TypeInfoResolverChain.Insert(0, OrchestratorJsonContext.Default));

builder.Services.AddSingleton(options);
builder.Services.AddSingleton<SessionRegistry>();

var app = builder.Build();
app.UseWebSockets();

var registry = app.Services.GetRequiredService<SessionRegistry>();

app.MapGet("/ready", () =>
{
    var firefox = registry.FirefoxPresent;
    var supervisor = registry.SupervisorPresent;
    var ok = firefox && supervisor;
    var body = new ReadyResponse(ok, registry.Count, registry.Capacity, firefox);
    return Results.Json(body, OrchestratorJsonContext.Default.ReadyResponse, statusCode: ok ? 200 : 503);
});

app.MapPost("/sessions", async (AllocateRequest? request, CancellationToken ct) =>
{
    if (request is null || !Guid.TryParse(request.SessionId, out var sessionId))
    {
        return Results.Json(
            new ErrorBody("sessionId inválido", "invalid_session_id", "allocate"),
            OrchestratorJsonContext.Default.ErrorBody,
            statusCode: 400);
    }

    try
    {
        var pair = await registry.AllocateAsync(sessionId, request.Width, request.Height, ct)
            .ConfigureAwait(false);
        return Results.Json(
            new AllocateResponse(pair.SessionId.ToString("D"), $"/sessions/{pair.SessionId:D}"),
            OrchestratorJsonContext.Default.AllocateResponse,
            statusCode: 201);
    }
    catch (InvalidOperationException ex) when (ex.Message == "host_full")
    {
        return Results.Json(
            new ErrorBody("host cheio", "host_full", "allocate"),
            OrchestratorJsonContext.Default.ErrorBody,
            statusCode: 503);
    }
    catch (InvalidOperationException ex) when (ex.Message == "session_exists")
    {
        return Results.Json(
            new ErrorBody("sessão já alocada", "session_exists", "allocate"),
            OrchestratorJsonContext.Default.ErrorBody,
            statusCode: 409);
    }
    catch (FileNotFoundException ex)
    {
        return Results.Json(
            new ErrorBody(ex.Message, "binary_missing", "allocate"),
            OrchestratorJsonContext.Default.ErrorBody,
            statusCode: 503);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "falha ao alocar {SessionId}", sessionId);
        return Results.Json(
            new ErrorBody(ex.Message, "allocate_failed", "allocate"),
            OrchestratorJsonContext.Default.ErrorBody,
            statusCode: 500);
    }
});

app.MapDelete("/sessions/{id}", (string id) =>
{
    if (!Guid.TryParse(id, out var sessionId))
    {
        return Results.Json(
            new ErrorBody("sessionId inválido", "invalid_session_id", "kill"),
            OrchestratorJsonContext.Default.ErrorBody,
            statusCode: 400);
    }

    registry.Kill(sessionId);
    return Results.NoContent();
});

app.MapGet("/sessions/{id}", async (HttpContext context, string id) =>
{
    if (!Guid.TryParse(id, out var sessionId) || !registry.TryGet(sessionId, out var pair))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    try
    {
        await pair.ServeApplicationAsync(socket, context.RequestAborted);
    }
    catch (InvalidOperationException ex) when (ex.Message == "caller_attached")
    {
        context.Response.StatusCode = StatusCodes.Status409Conflict;
    }
});

app.Logger.LogInformation(
    "orquestrador :{Port} · supervisor={Supervisor} · firefox={Firefox} · teto={Max}",
    options.ListenPort,
    options.SupervisorExecutable,
    options.BrowserExecutable,
    options.MaxPairs);

app.Run();
