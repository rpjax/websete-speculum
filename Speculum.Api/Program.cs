using System.Net;
using Speculum.Api.Admin;
using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Scripts;
using Speculum.Api.Config.Store;
using Speculum.Api.Hosting;
using Speculum.Api.Scripts;
using Speculum.Api.Virtualization;
using Speculum.Api.Virtualization.Contracts;
using Speculum.Api.Virtualization.Options;
using Speculum.Api.Virtualization.Persistence;
using Speculum.Api.Virtualization.Presentation;
using Speculum.Api.Virtualization.Sidecar;
using Speculum.Api.Middleware;

var builder = WebApplication.CreateBuilder(args);

var bootstrap = BootstrapConfig.Load(builder.Configuration);
builder.Services.AddSingleton(bootstrap);

if (!IPEndPoint.TryParse(bootstrap.HttpAddress, out var listenEndpoint))
    throw new InvalidOperationException($"Invalid HttpAddress '{bootstrap.HttpAddress}'.");

builder.WebHost.ConfigureKestrel(kestrel =>
{
    kestrel.Listen(listenEndpoint.Address, listenEndpoint.Port);
});

builder.Services.AddCors();
builder.Services.AddSingleton<Microsoft.AspNetCore.Cors.Infrastructure.ICorsPolicyProvider, DynamicCorsPolicyProvider>();

builder.Services.AddSingleton<IDnsResolver, SystemDnsResolver>();

builder.Services.AddHttpClient(nameof(ScriptResolver), client =>
{
    client.Timeout = TimeSpan.FromSeconds(15);
})
.ConfigurePrimaryHttpMessageHandler(sp =>
    ScriptResolverHttpHandler.Create(sp.GetRequiredService<IDnsResolver>()));

builder.Services.AddSingleton<IInjectedScriptStore>(sp =>
    new InjectedScriptStore(bootstrap.DatabasePath));
builder.Services.AddSingleton<ScriptResolver>();
builder.Services.AddSingleton<IVSessionRegistry, VSessionRegistry>();
builder.Services.AddSingleton<IBrowserSessionStore>(sp =>
    new BrowserSessionStore(
        bootstrap.DatabasePath,
        sp.GetRequiredService<ILogger<BrowserSessionStore>>()));
builder.Services.AddSingleton<EdgeTlsWriter>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<EdgeTlsWriter>());
builder.Services.AddSingleton<ISpeculumConfigStore>(sp =>
    new SpeculumConfigStore(
        bootstrap.DatabasePath,
        bootstrap,
        sp.GetRequiredService<ScriptResolver>(),
        sp.GetRequiredService<IInjectedScriptStore>(),
        sp.GetRequiredService<IVSessionRegistry>(),
        sp.GetRequiredService<IBrowserSessionStore>(),
        sp.GetRequiredService<IWebHostEnvironment>(),
        sp.GetRequiredService<ILogger<SpeculumConfigStore>>(),
        sp));

builder.Services.AddHostedService<GracefulShutdownHostedService>();

builder.Services.AddSingleton(new SidecarBrowserClientOptions
{
    SidecarBaseUrl = bootstrap.SidecarBaseUrl,
});

builder.Services.AddSignalR(options =>
{
    options.MaximumReceiveMessageSize = 512 * 1024;
    options.StreamBufferCapacity      = 16;
}).AddMessagePackProtocol();
builder.Services.AddOpenApi();

var app = builder.Build();

var configStore = app.Services.GetRequiredService<ISpeculumConfigStore>();
var sessionStore = app.Services.GetRequiredService<IBrowserSessionStore>();
var scriptStore = app.Services.GetRequiredService<IInjectedScriptStore>();

await scriptStore.InitializeAsync();
await sessionStore.InitializeAsync();
await configStore.InitializeAsync();

app.UseRouting();
app.UseCors();
app.UseMiddleware<SecurityHeadersMiddleware>();
app.UseMiddleware<AdminAuthMiddleware>();

app.MapOpenApi();
app.MapPublicEndpoints();
app.MapAdminEndpoints();
app.MapHub<VirtualizationHub>("/vhub", options =>
{
    options.TransportMaxBufferSize    = 512 * 1024;
    options.ApplicationMaxBufferSize  = 512 * 1024;
});

app.Run();
