using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Speculum.Api.Database;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Profiles.Events.Services;
using Speculum.Api.Profiles.Events.Services.Contracts;
using Speculum.Api.Profiles.Services;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Profiles.Storage;

namespace Speculum.Api.Profiles;

public static class ProfilesServiceCollectionExtensions
{
    /// <summary>
    /// Registers profile-domain infrastructure (repo, service, journal events factory).
    /// Requires <c>AddDatabase()</c> and <c>AddJournal()</c> first.
    /// </summary>
    public static IServiceCollection AddProfiles(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        if (!services.Any(d => d.ServiceType == typeof(SpeculumDbContext)))
        {
            throw new InvalidOperationException(
                "AddProfiles requires AddDatabase() to be called first.");
        }

        if (!services.Any(d => d.ServiceType == typeof(IJournalWriter)))
        {
            throw new InvalidOperationException(
                "AddProfiles requires AddJournal() to be called first.");
        }

        services.TryAddScoped<IProfileRepository, EfProfileRepository>();
        services.TryAddScoped<IProfileService, ProfileService>();
        services.TryAddSingleton<IProfileEventsFactory, ProfileEventsFactory>();
        services.TryAddSingleton<
            Speculum.Api.Telemetry.Ports.IProfileTelemetrySampleSource,
            Speculum.Api.Profiles.Telemetry.ProfileTelemetrySampleSource>();

        return services;
    }
}
