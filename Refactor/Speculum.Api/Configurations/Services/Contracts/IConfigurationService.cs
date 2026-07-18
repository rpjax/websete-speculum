using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Configurations.Models.Profiles;
using Speculum.Api.Configurations.Models.ResourceManagement;

namespace Speculum.Api.Configurations.Services.Contracts;

// root object - all configs
public class EngineConfiguration
{
    public HostingConfiguration Hosting { get; set; }
    public NavigationConfiguration Navigation { get; set; }
    public SessionsConfiguration Sessions { get; set; }
    public ProfilesConfiguration Profiles { get; set; }
    public ResourceManagementConfiguration ResourceManagement { get; set; }
}

public interface IConfigurationService
{
}
