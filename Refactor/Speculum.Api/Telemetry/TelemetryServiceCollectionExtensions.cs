using Microsoft.Extensions.DependencyInjection.Extensions;
using Speculum.Api.Telemetry.Probes;
using Speculum.Api.Telemetry.Sources;

namespace Speculum.Api.Telemetry;

public static class TelemetryServiceCollectionExtensions
{
    public static IServiceCollection AddTelemetry(this IServiceCollection services)
    {
        services.TryAddSingleton<MachineResourceProbe>();
        services.TryAddSingleton<ApiProcessResourceProbe>();
        services.TryAddSingleton<IHostTelemetrySource, HostTelemetrySource>();
        services.TryAddSingleton<IApiProcessTelemetrySource, ApiProcessTelemetrySource>();
        services.TryAddSingleton<ISessionsTelemetrySource, SessionsTelemetrySource>();
        services.TryAddSingleton<ISidecarTelemetrySource, SidecarTelemetrySource>();
        services.TryAddSingleton<IProfilesTelemetrySource, ProfilesTelemetrySource>();
        services.TryAddSingleton<IJournalTelemetrySource, JournalTelemetrySource>();
        services.TryAddSingleton<IDockerTelemetrySource, DockerTelemetrySource>();
        services.TryAddSingleton<ITelemetrySampleComposer, TelemetrySampleComposer>();
        services.TryAddSingleton<ITelemetryEmitter, TelemetryEmitter>();
        services.AddHostedService<TelemetrySamplerHostedService>();
        return services;
    }
}
