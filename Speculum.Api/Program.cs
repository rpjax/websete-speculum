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

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(bootstrap.CorsAllowedOrigins.ToArray())
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

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
builder.Services.AddSingleton<IBrowserSnapshotStore>(sp =>
    new BrowserSnapshotStore(
        bootstrap.DatabasePath,
        sp.GetRequiredService<ILogger<BrowserSnapshotStore>>()));
builder.Services.AddSingleton<ISidecarProfileMergeClient>(sp =>
    new SidecarProfileMergeClient(sp.GetRequiredService<SidecarBrowserClientOptions>()));
builder.Services.AddSingleton<IProfileSnapshotMerger, ProfileSnapshotMerger>();
builder.Services.AddSingleton<ISpeculumConfigStore>(sp =>
    new SpeculumConfigStore(
        bootstrap.DatabasePath,
        sp.GetRequiredService<ScriptResolver>(),
        sp.GetRequiredService<IInjectedScriptStore>(),
        sp.GetRequiredService<IVSessionRegistry>(),
        sp.GetRequiredService<IProfileSnapshotMerger>(),
        sp.GetRequiredService<IBrowserSnapshotStore>(),
        sp.GetRequiredService<IWebHostEnvironment>(),
        sp.GetRequiredService<ILogger<SpeculumConfigStore>>()));

builder.Services.AddHostedService<GracefulShutdownHostedService>();

builder.Services.AddSingleton(new SidecarBrowserClientOptions
{
    SidecarBaseUrl = bootstrap.SidecarBaseUrl,
});

builder.Services.AddSignalR().AddMessagePackProtocol();
builder.Services.AddOpenApi();

var app = builder.Build();

var configStore = app.Services.GetRequiredService<ISpeculumConfigStore>();
var snapshotStore = app.Services.GetRequiredService<IBrowserSnapshotStore>();
var scriptStore = app.Services.GetRequiredService<IInjectedScriptStore>();

await scriptStore.InitializeAsync();
await snapshotStore.InitializeAsync();
await configStore.InitializeAsync();

app.UseRouting();
app.UseCors();
app.UseMiddleware<SecurityHeadersMiddleware>();
app.UseMiddleware<AdminAuthMiddleware>();

app.MapOpenApi();
app.MapAdminEndpoints();
app.MapHub<VirtualizationHub>("/vhub");

app.Run();
