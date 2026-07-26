using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Diagnostics;
using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Models.Profiles;
using Speculum.Api.Configurations.Models.ResourceManagement;
using Speculum.Api.Configurations.Models.Scripting;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Configurations.Services.Contracts;

namespace Speculum.Api.Configurations.Services;

public sealed class ConfigurationService : IConfigurationService
{
    private readonly IOptionsMonitor<HostingConfiguration> _hosting;
    private readonly IOptionsMonitor<NavigationConfiguration> _navigation;
    private readonly IOptionsMonitor<SessionsConfiguration> _sessions;
    private readonly IOptionsMonitor<ProfilesConfiguration> _profiles;
    private readonly IOptionsMonitor<ResourceManagementConfiguration> _resources;
    private readonly IOptionsMonitor<ScriptingConfiguration> _scripting;
    private readonly IOptionsMonitor<DiagnosticsConfiguration> _diagnostics;
    private readonly object _gate = new();
    private HostingConfiguration? _hostingOverride;
    private NavigationConfiguration? _navigationOverride;

    public ConfigurationService(
        IOptionsMonitor<HostingConfiguration> hosting,
        IOptionsMonitor<NavigationConfiguration> navigation,
        IOptionsMonitor<SessionsConfiguration> sessions,
        IOptionsMonitor<ProfilesConfiguration> profiles,
        IOptionsMonitor<ResourceManagementConfiguration> resources,
        IOptionsMonitor<ScriptingConfiguration> scripting,
        IOptionsMonitor<DiagnosticsConfiguration> diagnostics)
    {
        _hosting = hosting;
        _navigation = navigation;
        _sessions = sessions;
        _profiles = profiles;
        _resources = resources;
        _scripting = scripting;
        _diagnostics = diagnostics;
    }

    public EngineConfiguration GetCurrent()
    {
        lock (_gate)
        {
            return new EngineConfiguration
            {
                Hosting = _hostingOverride ?? _hosting.CurrentValue,
                Navigation = _navigationOverride ?? _navigation.CurrentValue,
                Sessions = _sessions.CurrentValue,
                Profiles = _profiles.CurrentValue,
                ResourceManagement = _resources.CurrentValue,
                Scripting = _scripting.CurrentValue,
                Diagnostics = _diagnostics.CurrentValue,
            };
        }
    }

    public void SetHosting(HostingConfiguration hosting)
    {
        ArgumentNullException.ThrowIfNull(hosting);
        lock (_gate)
        {
            _hostingOverride = hosting;
        }
    }

    public void SetNavigation(NavigationConfiguration navigation)
    {
        ArgumentNullException.ThrowIfNull(navigation);
        lock (_gate)
        {
            _navigationOverride = navigation;
        }
    }
}
