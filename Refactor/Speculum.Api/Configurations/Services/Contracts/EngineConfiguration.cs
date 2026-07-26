using Speculum.Api.Configurations.Models.Diagnostics;
using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Models.Profiles;
using Speculum.Api.Configurations.Models.ResourceManagement;
using Speculum.Api.Configurations.Models.Scripting;
using Speculum.Api.Configurations.Models.Sessions;

namespace Speculum.Api.Configurations.Services.Contracts;

public sealed class EngineConfiguration
{
    public HostingConfiguration Hosting { get; set; } = new();
    public NavigationConfiguration Navigation { get; set; } = new();
    public SessionsConfiguration Sessions { get; set; } = new();
    public ProfilesConfiguration Profiles { get; set; } = new();
    public ResourceManagementConfiguration ResourceManagement { get; set; } = new();
    public ScriptingConfiguration Scripting { get; set; } = new();
    public DiagnosticsConfiguration Diagnostics { get; set; } = new();
}
