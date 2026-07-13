using System.Net;
using Speculum.Api.Admin;
using Speculum.Api.Config.Application;
using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Persistence;
using Speculum.Api.Config.Store;
using Speculum.Api.Edge;
using Speculum.Api.Edge.Cors;
using Speculum.Api.Infrastructure;
using Speculum.Api.Middleware;
using Speculum.Api.Motor.Mapping;
using Speculum.Api.Scripts;
using Speculum.Api.Motor.Live;
using Speculum.Api.Motor.Sidecar;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Composition;

public static class ServiceRegistration
{
    public static void AddSpeculumServices(this WebApplicationBuilder builder)
    {
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
        builder.Services.AddSingleton<IMotorSessionRegistry, MotorSessionRegistry>();
        builder.Services.AddSingleton<ISidecarClientFactory, SidecarClientFactory>();
        builder.Services.AddSingleton<IMotorSessionFactory, MotorSessionFactory>();
        builder.Services.AddSingleton<MotorSessionCoordinator>();
        builder.Services.AddSingleton<IBrowserSessionStore>(sp =>
            new BrowserSessionStore(
                bootstrap.DatabasePath,
                sp.GetRequiredService<ILogger<BrowserSessionStore>>()));
        builder.Services.AddSingleton<MotorSecretsStore>(_ => new MotorSecretsStore(bootstrap.DatabasePath));
        builder.Services.AddSingleton<NavigationStateCodec>(sp =>
        {
            var secrets = sp.GetRequiredService<MotorSecretsStore>();
            var key = secrets.GetOrCreateNavigationStateKeyAsync().GetAwaiter().GetResult();
            return new NavigationStateCodec(key, encrypt: !bootstrap.IsDevelopment);
        });
        builder.Services.AddSingleton<MotorUrlAdapter>();
        builder.Services.AddSingleton<TraefikReloader>();
        builder.Services.AddSingleton<Lazy<ISpeculumConfigStore>>(sp =>
            new Lazy<ISpeculumConfigStore>(() => sp.GetRequiredService<ISpeculumConfigStore>()));

        builder.Services.AddSingleton<ConfigSectionRepository>(_ =>
            new ConfigSectionRepository(bootstrap.DatabasePath));
        builder.Services.AddSingleton<ConfigLoader>();
        builder.Services.AddSingleton<IEdgeSynchronizer, EdgeSynchronizer>();
        builder.Services.AddSingleton<IConfigChangeHandler, MotorSessionDrainHandler>();
        builder.Services.AddSingleton<IConfigChangeHandler, EdgeSyncConfigHandler>();
        builder.Services.AddSingleton<ISpeculumConfigStore, ConfigService>();

        builder.Services.AddSingleton<EdgeWriter>();
        builder.Services.AddHostedService(sp => sp.GetRequiredService<EdgeWriter>());
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
    }

    public static void UseSpeculumPipeline(this WebApplication app)
    {
        app.UseRouting();
        app.UseCors();
        app.UseMiddleware<SecurityHeadersMiddleware>();
        app.UseMiddleware<AdminAuthMiddleware>();

        app.MapOpenApi();
        app.MapPublicEndpoints();
        app.MapAdminEndpoints();
        app.MapHub<MotorHub>("/vhub", options =>
        {
            options.TransportMaxBufferSize    = 512 * 1024;
            options.ApplicationMaxBufferSize  = 512 * 1024;
        });
    }
}
