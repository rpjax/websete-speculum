using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Speculum.Api.BrowserProfiles.Services.Contracts;
using Speculum.Api.BrowserProfiles.Storage;
using Speculum.Api.BrowserSessions.Services;
using Speculum.Api.BrowserSessions.Services.Contracts;
using Speculum.Api.BrowserSessions.Storage;
using Speculum.Api.Configurations.Models.ResourceManagement;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Database;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.BrowserSessions;

public static class BrowserSessionsServiceCollectionExtensions
{
    /// <summary>
    /// Registers session-domain infrastructure (repos, slots, collector, lifecycle journal).
    /// Does not register <see cref="ISessionService"/> or <see cref="IInitialUrlResolver"/>.
    /// Requires <c>AddDatabase()</c> and <c>AddJournal()</c> first.
    /// </summary>
    public static IServiceCollection AddBrowserSessions(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        if (!services.Any(d => d.ServiceType == typeof(SpeculumDbContext)))
        {
            throw new InvalidOperationException(
                "AddBrowserSessions requires AddDatabase() to be called first.");
        }

        if (!services.Any(d => d.ServiceType == typeof(IJournalWriter)))
        {
            throw new InvalidOperationException(
                "AddBrowserSessions requires AddJournal() to be called first.");
        }

        services.AddOptions<ResourceManagementConfiguration>()
            .BindConfiguration(ResourceManagementConfiguration.SectionName)
            .ValidateOnStart();

        services.TryAddEnumerable(
            ServiceDescriptor.Singleton<IValidateOptions<ResourceManagementConfiguration>, ResourceManagementConfigurationValidator>());

        services.AddOptions<SessionsConfiguration>()
            .BindConfiguration(SessionsConfiguration.SectionName)
            .ValidateOnStart();

        services.TryAddEnumerable(
            ServiceDescriptor.Singleton<IValidateOptions<SessionsConfiguration>, SessionsConfigurationValidator>());

        services.TryAddScoped<ISessionRepository, EfSessionRepository>();
        services.TryAddScoped<IProfileRepository, EfProfileRepository>();
        services.TryAddSingleton<ISessionSlotRegistry, SessionSlotRegistry>();
        services.TryAddSingleton<ISessionCollector, SessionCollector>();
        services.TryAddSingleton<ISessionLifecycleEvents, JournalSessionLifecycleEvents>();
        services.TryAddSingleton<ISessionStartEvents, NullSessionStartEvents>();
        services.TryAddSingleton<ISessionStopEvents, NullSessionStopEvents>();

        return services;
    }
}
