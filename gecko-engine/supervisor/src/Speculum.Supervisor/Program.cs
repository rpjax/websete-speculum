using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Speculum.Supervisor;
using Speculum.Supervisor.Browser;
using Speculum.Supervisor.Consumers;

ProcessDeath.BindToParent();

var options = SupervisorOptions.FromEnvironment();


var builder = WebApplication.CreateSlimBuilder(args);
builder.Logging.AddSimpleConsole(c => c.SingleLine = true);
builder.WebHost.ConfigureKestrel(k => k.ListenAnyIP(options.ConsumerPort));
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.TypeInfoResolverChain.Insert(0, SupervisorJsonContext.Default));

builder.Services.AddSingleton(options);
builder.Services.AddSingleton<ConsumerHub>();
builder.Services.AddHostedService<BrowserLink>();

var app = builder.Build();
app.UseWebSockets();

var hub = app.Services.GetRequiredService<ConsumerHub>();

// Plano de consumo. Binário = frame opaco. O JSON de controle entra no F2.
app.Map("/session", async (HttpContext context) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    await hub.ServeAsync(socket, context.RequestAborted);
});

app.MapGet("/health", () => TypedResults.Json(
    new HealthResponse(true, hub.Count, hub.FramesDropped, options.CapEvents, options.CapMetrics),
    SupervisorJsonContext.Default.HealthResponse));

app.Logger.LogInformation(
    "supervisor: consumidores em :{Port}/session · browser em {Socket} · caps.events={Events} caps.metrics={Metrics}",
    options.ConsumerPort,
    options.BrowserSocketPath,
    options.CapEvents,
    options.CapMetrics);

app.Run();
