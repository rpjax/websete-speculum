using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.ResourceManagement;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Database;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Profiles.Storage;
using Speculum.Api.Sessions.Events.Services;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Sessions.Storage;
using Speculum.Api.Shared.Services;
using Speculum.Api.Shared.Services.Contracts;

namespace Speculum.Api.Sessions;

public static class BrowserSessionsServiceCollectionExtensions
{
    /// <summary>
    /// Registers session-domain infrastructure (repos, slots, collector, lifecycle journal,
    /// <see cref="ILiveSessionService"/>).
    /// Does not register <see cref="ISessionService"/> or <see cref="IUrlResolver"/> —
    /// host wires those together (<see cref="ILiveSessionService"/> requires
    /// <see cref="IUrlResolver"/>).
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
        // Keep TryAdd so composition tests that only call AddBrowserSessions still resolve
        // the profile store; hosts should prefer AddProfiles() for the full profile stack.
        services.TryAddScoped<IProfileRepository, EfProfileRepository>();
        services.TryAddSingleton<ISessionSlotRegistry, SessionSlotRegistry>();
        services.TryAddSingleton<ISessionCollector, SessionCollector>();
        services.TryAddSingleton<ISessionBindingRegistry, SessionBindingRegistry>();
        services.TryAddSingleton<ISessionEventsFactory, SessionEventsFactory>();
        services.TryAddSingleton<ISessionTokenGenerator, SessionTokenGenerator>();
        services.TryAddSingleton<ILaunchScriptResolver, LaunchScriptResolver>();
        // Session lifecycle gate only. LiveSessionService owns a separate registry lock —
        // sharing this instance deadlocks StopSession (holds gate → Release tries same key).
        services.TryAddSingleton<IAsyncScopedMutex>(_ => new ScopedMutex());
        services.TryAddSingleton<ILiveSessionService, LiveSessionService>();

        return services;
    }
}
