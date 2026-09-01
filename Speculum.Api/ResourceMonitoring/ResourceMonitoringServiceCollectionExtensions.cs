using Microsoft.Extensions.DependencyInjection.Extensions;
using Speculum.Api.Database;
using Speculum.Api.ResourceMonitoring.Services;
using Speculum.Api.ResourceMonitoring.Services.Contracts;

namespace Speculum.Api.ResourceMonitoring;

public static class ResourceMonitoringServiceCollectionExtensions
{
    public static IServiceCollection AddResourceMonitoring(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        if (!services.Any(d => d.ServiceType == typeof(SpeculumDbContext)))
        {
            throw new InvalidOperationException(
                "AddResourceMonitoring requires AddDatabase() to be called first.");
        }

        services.TryAddSingleton(TimeProvider.System);
        services.TryAddScoped<IResourceHistoryService, ResourceHistoryService>();
        services.TryAddScoped<IResourceSignalStore, EfResourceSignalStore>();
        services.TryAddScoped<IResourceReportStore, EfResourceReportStore>();
        services.TryAddSingleton<IResourceReportQueue, ResourceReportQueue>();
        services.AddHostedService<ResourceSignalDetectorHostedService>();
        services.AddHostedService<ReportMaterializerHostedService>();

        return services;
    }
}
