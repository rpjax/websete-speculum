using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Speculum.Api.BrowserClients.Gecko;
using Speculum.Api.BrowserClients.Grpc;
using Speculum.Api.Configurations.Models.Sidecar;

namespace Speculum.Api.BrowserClients;

public static class BrowserClientsServiceCollectionExtensions
{
    public static IServiceCollection AddGrpcBrowserClient(this IServiceCollection services)
    {
        services.AddSingleton<IValidateOptions<SidecarOptions>, SidecarOptionsValidator>();
        services
            .AddOptions<SidecarOptions>()
            .BindConfiguration(SidecarOptions.SectionName)
            .ValidateOnStart();

        services.AddHttpClient(GeckoBrowserClient.HttpClientName, (sp, client) =>
        {
            var address = sp.GetRequiredService<IOptions<SidecarOptions>>().Value.OrchestratorAddress;
            client.BaseAddress = new Uri(address.TrimEnd('/') + "/");
            client.Timeout = TimeSpan.FromSeconds(30);
        });

        services.AddSingleton<IBrowserClient>(sp =>
        {
            var engine = sp.GetRequiredService<IOptions<SidecarOptions>>().Value.Engine;
            return engine == SidecarEngine.Gecko
                ? ActivatorUtilities.CreateInstance<GeckoBrowserClient>(sp)
                : ActivatorUtilities.CreateInstance<GrpcBrowserClient>(sp);
        });
        services.AddSingleton<
            Speculum.Api.Telemetry.Ports.ISidecarTelemetrySampleSource,
            Speculum.Api.BrowserClients.Telemetry.SidecarTelemetrySampleSource>();
        services.AddHealthChecks()
            .AddCheck<GeckoOrchestratorHealthCheck>("gecko-orchestrator", tags: ["ready"]);
        return services;
    }
}
