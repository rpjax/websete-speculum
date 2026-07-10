using System.Net;
using Websete.Speculum.Host.Admin;
using Websete.Speculum.Host.Config.Bootstrap;
using Websete.Speculum.Host.Config.Scripts;
using Websete.Speculum.Host.Config.Store;
using Websete.Speculum.Host.Middleware;
using Websete.Speculum.Host.Virtualization;
using Websete.Speculum.Host.Virtualization.Contracts;
using Websete.Speculum.Host.Virtualization.Options;
using Websete.Speculum.Host.Virtualization.Presentation;
using Websete.Speculum.Host.Virtualization.Sidecar;

var builder = WebApplication.CreateBuilder(args);

var bootstrap = BootstrapConfig.Load(builder.Configuration);
builder.Services.AddSingleton(bootstrap);

if (!IPEndPoint.TryParse(bootstrap.HttpAddress, out var listenEndpoint))
    throw new InvalidOperationException($"Invalid HttpAddress '{bootstrap.HttpAddress}'.");

builder.WebHost.ConfigureKestrel(kestrel =>
{
    kestrel.Listen(listenEndpoint.Address, listenEndpoint.Port);
});

builder.Services.AddHttpClient(nameof(ScriptResolver));
builder.Services.AddSingleton<ScriptResolver>();
builder.Services.AddSingleton<IVSessionRegistry, VSessionRegistry>();
builder.Services.AddSingleton<ISpeculumConfigStore>(sp =>
    new SpeculumConfigStore(
        bootstrap.DatabasePath,
        builder.Configuration,
        sp.GetRequiredService<ScriptResolver>(),
        sp.GetRequiredService<IVSessionRegistry>(),
        sp.GetRequiredService<IWebHostEnvironment>(),
        sp.GetRequiredService<ILogger<SpeculumConfigStore>>()));

builder.Services.AddSingleton(new SidecarBrowserClientOptions
{
    SidecarBaseUrl = bootstrap.SidecarBaseUrl,
});

builder.Services.AddSignalR();
builder.Services.AddOpenApi();

var app = builder.Build();

var configStore = app.Services.GetRequiredService<ISpeculumConfigStore>();
await configStore.InitializeAsync();

app.UseMiddleware<AdminAuthMiddleware>();
app.UseMiddleware<SetupMiddleware>();

app.MapOpenApi();

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        if (ctx.File.Name.Equals("index.html", StringComparison.OrdinalIgnoreCase)
            || ctx.File.Name.Equals("setup.html", StringComparison.OrdinalIgnoreCase))
        {
            ctx.Context.Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
            ctx.Context.Response.Headers["Pragma"]        = "no-cache";
        }
    },
});

app.MapAdminEndpoints();
app.MapGet("/setup", async ctx =>
{
    var path = Path.Combine(app.Environment.WebRootPath, "setup.html");
    await ctx.Response.SendFileAsync(path);
});
app.MapHub<VirtualizationHub>("/vhub");
app.MapFallbackToFile("index.html");

app.Run();
