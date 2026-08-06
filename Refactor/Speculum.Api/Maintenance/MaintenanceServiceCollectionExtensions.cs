using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Speculum.Api.Maintenance.Services;
using Speculum.Api.Maintenance.Services.Contracts;

namespace Speculum.Api.Maintenance;

public static class MaintenanceServiceCollectionExtensions
{
    /// <summary>Registers the Maintenance choke point (see <see cref="IMaintenanceService"/>).</summary>
    public static IServiceCollection AddMaintenance(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.TryAddScoped<IMaintenanceService, MaintenanceService>();
        return services;
    }
}
