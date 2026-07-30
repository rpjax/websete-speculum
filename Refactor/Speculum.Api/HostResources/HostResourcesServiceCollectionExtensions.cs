using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Speculum.Api.Database;
using Speculum.Api.HostResources.Services;
using Speculum.Api.HostResources.Services.Contracts;
using Speculum.Api.HostResources.Storage;
using Speculum.Api.Telemetry.Probes;

namespace Speculum.Api.HostResources;

public static class HostResourcesServiceCollectionExtensions
{
    public static IServiceCollection AddHostResources(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        if (!services.Any(d => d.ServiceType == typeof(SpeculumDbContext)))
        {
            throw new InvalidOperationException(
                "AddHostResources requires AddDatabase() to be called first.");
        }

        services.TryAddSingleton<MachineResourceProbe>();
        services.TryAddScoped<IHostResourceApplyStore, EfHostResourceApplyStore>();
        services.TryAddScoped<IHostResourceProvisionService, HostResourceProvisionService>();

        return services;
    }
}
