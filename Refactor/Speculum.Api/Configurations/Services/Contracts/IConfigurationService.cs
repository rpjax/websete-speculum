using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Navigation;

namespace Speculum.Api.Configurations.Services.Contracts;

/// <summary>
/// Resolved engine configuration snapshot for Sessions (hosting, navigation, …).
/// Development may mutate Hosting/Navigation overlays via <see cref="SetHosting"/> /
/// <see cref="SetNavigation"/>; production uses bound options only.
/// </summary>
public interface IConfigurationService
{
    EngineConfiguration GetCurrent();

    /// <summary>Replaces the Hosting overlay (or base when no overlay exists).</summary>
    void SetHosting(HostingConfiguration hosting);

    /// <summary>Replaces the Navigation overlay (or base when no overlay exists).</summary>
    void SetNavigation(NavigationConfiguration navigation);
}
