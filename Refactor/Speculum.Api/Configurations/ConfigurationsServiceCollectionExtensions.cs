using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Diagnostics;
using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Models.Profiles;
using Speculum.Api.Configurations.Models.ResourceManagement;
using Speculum.Api.Configurations.Models.Scripting;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Configurations.Models.Telemetry;
using Speculum.Api.Configurations.Persistence;
using Speculum.Api.Configurations.Services;
using Speculum.Api.Configurations.Services.Contracts;

namespace Speculum.Api.Configurations;

public static class ConfigurationsServiceCollectionExtensions
{
    public static IServiceCollection AddEngineConfiguration(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Bound for first-boot merge only — runtime truth is SQLite → Apply → IConfigurationService.
        services.AddOptions<HostingConfiguration>()
            .BindConfiguration(HostingConfiguration.SectionName);
        services.AddOptions<NavigationConfiguration>()
            .BindConfiguration(NavigationConfiguration.SectionName);
        services.AddOptions<SessionsConfiguration>()
            .BindConfiguration(SessionsConfiguration.SectionName);
        services.AddOptions<ProfilesConfiguration>()
            .BindConfiguration(ProfilesConfiguration.SectionName);
        services.AddOptions<ResourceManagementConfiguration>()
            .BindConfiguration(ResourceManagementConfiguration.SectionName);
        services.AddOptions<ScriptingConfiguration>()
            .BindConfiguration(ScriptingConfiguration.SectionName);
        services.AddOptions<DiagnosticsConfiguration>()
            .BindConfiguration(DiagnosticsConfiguration.SectionName);
        // First-boot merge seed only — runtime truth is SQLite → Apply → EngineConfiguration.Telemetry.
        services.AddOptions<TelemetryConfiguration>()
            .BindConfiguration(TelemetryConfiguration.SectionName);

        services.TryAddEnumerable(
            ServiceDescriptor.Singleton<IValidateOptions<NavigationConfiguration>, NavigationConfigurationValidator>());
        services.TryAddEnumerable(
            ServiceDescriptor.Singleton<IValidateOptions<SessionsConfiguration>, SessionsConfigurationValidator>());
        services.TryAddEnumerable(
            ServiceDescriptor.Singleton<IValidateOptions<ResourceManagementConfiguration>, ResourceManagementConfigurationValidator>());

        services.TryAddSingleton<IConfigSectionStore, ConfigSectionStore>();
        services.TryAddSingleton<IConfigurationService, ConfigurationService>();
        services.TryAddSingleton<IConfigurationApplyService, ConfigurationApplyService>();
        services.TryAddSingleton<IConfigurationLoadService, ConfigurationLoadService>();

        services.AddHealthChecks()
            .AddCheck<PendingConfigHealthCheck>("pending-config", tags: ["ready"]);

        return services;
    }
}
