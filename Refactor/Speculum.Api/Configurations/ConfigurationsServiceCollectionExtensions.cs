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
using Speculum.Api.Configurations.Services;
using Speculum.Api.Configurations.Services.Contracts;

namespace Speculum.Api.Configurations;

public static class ConfigurationsServiceCollectionExtensions
{
    public static IServiceCollection AddEngineConfiguration(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddOptions<HostingConfiguration>()
            .BindConfiguration(HostingConfiguration.SectionName)
            .ValidateOnStart();
        services.AddOptions<NavigationConfiguration>()
            .BindConfiguration(NavigationConfiguration.SectionName)
            .ValidateOnStart();
        services.AddOptions<SessionsConfiguration>()
            .BindConfiguration(SessionsConfiguration.SectionName)
            .ValidateOnStart();
        services.AddOptions<ProfilesConfiguration>()
            .BindConfiguration(ProfilesConfiguration.SectionName);
        services.AddOptions<ResourceManagementConfiguration>()
            .BindConfiguration(ResourceManagementConfiguration.SectionName)
            .ValidateOnStart();
        services.AddOptions<ScriptingConfiguration>()
            .BindConfiguration(ScriptingConfiguration.SectionName);
        services.AddOptions<DiagnosticsConfiguration>()
            .BindConfiguration(DiagnosticsConfiguration.SectionName);

        services.TryAddEnumerable(
            ServiceDescriptor.Singleton<IValidateOptions<NavigationConfiguration>, NavigationConfigurationValidator>());
        services.TryAddEnumerable(
            ServiceDescriptor.Singleton<IValidateOptions<SessionsConfiguration>, SessionsConfigurationValidator>());
        services.TryAddEnumerable(
            ServiceDescriptor.Singleton<IValidateOptions<ResourceManagementConfiguration>, ResourceManagementConfigurationValidator>());
        services.TryAddSingleton<IConfigurationService, ConfigurationService>();

        return services;
    }
}
