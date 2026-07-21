using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Speculum.Api.Database;
using Speculum.Api.Journal.Services;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Journal.Storage;

namespace Speculum.Api.Journal;

public static class JournalServiceCollectionExtensions
{
    /// <summary>
    /// Registers Journal admission, drain, health, and metrics.
    /// Requires <c>AddDatabase()</c> first. Call <see cref="DiscoverJournalFacts"/> to scan facts.
    /// </summary>
    public static IServiceCollection AddJournal(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        if (!services.Any(d => d.ServiceType == typeof(SpeculumDbContext)))
        {
            throw new InvalidOperationException(
                "AddJournal requires AddDatabase() to be called first.");
        }

        services.AddOptions<JournalDrainOptions>()
            .BindConfiguration(JournalDrainOptions.SectionName)
            .ValidateOnStart();

        services.TryAddEnumerable(
            ServiceDescriptor.Singleton<IValidateOptions<JournalDrainOptions>, JournalDrainOptionsValidator>());

        // Instance registration so DiscoverJournalFacts can mutate assemblies before Build.
        services.TryAddSingleton(new JournalFactDiscovery());

        services.TryAddSingleton<JournalCatalog>(sp =>
        {
            var catalog = new JournalCatalog();
            var assemblies = sp.GetRequiredService<JournalFactDiscovery>().Assemblies;
            if (assemblies.Count > 0)
                catalog.RegisterFromAssemblies(assemblies.ToArray());
            return catalog;
        });
        services.TryAddSingleton<IJournalCatalog>(sp => sp.GetRequiredService<JournalCatalog>());

        services.TryAddSingleton<JournalDrainMetrics>();
        services.TryAddSingleton<IJournalHealth, JournalHealth>();
        services.TryAddSingleton<IJournalDrainPolicy, JournalDrainPolicy>();
        services.TryAddSingleton<IJournalQueue, JournalQueue>();
        services.TryAddSingleton<IJournalWriter, JournalWriter>();
        services.TryAddSingleton(TimeProvider.System);

        services.TryAddScoped<IJournalRepository, JournalRepository>();
        services.TryAddScoped<IJournalReader, JournalReader>();
        services.TryAddSingleton<JournalHealthCheck>();

        if (!services.Any(d => d.ServiceType == typeof(JournalWorkerRegistration)))
        {
            services.AddSingleton<JournalWorkerRegistration>();
            services.AddHostedService<JournalWorker>();
        }

        // Marker avoids duplicate health-check registration when AddJournal is called twice.
        if (!services.Any(d => d.ServiceType == typeof(JournalHealthCheckRegistration)))
        {
            services.AddSingleton<JournalHealthCheckRegistration>();
            services.AddHealthChecks()
                .AddCheck<JournalHealthCheck>("journal", tags: ["journal", "ready"]);
        }

        return services;
    }

    /// <summary>
    /// Scans the Speculum.Api assembly for <c>[JournalFact]</c> types and queues them
    /// for catalog registration. Requires <see cref="AddJournal"/> first.
    /// </summary>
    public static IServiceCollection DiscoverJournalFacts(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        var discovery = services
            .Select(d => d.ImplementationInstance)
            .OfType<JournalFactDiscovery>()
            .FirstOrDefault();

        if (discovery is null)
        {
            throw new InvalidOperationException(
                "DiscoverJournalFacts requires AddJournal() to be called first.");
        }

        // Executing assembly is Speculum.Api (this extension lives there), which owns fact types.
        discovery.Add(Assembly.GetExecutingAssembly());
        return services;
    }

    private sealed class JournalHealthCheckRegistration;

    private sealed class JournalWorkerRegistration;
}
