using Speculum.Api.Configurations.Models.Diagnostics;
using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Journal;
using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Models.Profiles;
using Speculum.Api.Configurations.Models.ResourceManagement;
using Speculum.Api.Configurations.Models.Scripting;
using Speculum.Api.Configurations.Models.Sessions;

namespace Speculum.Api.Configurations.Services.Contracts;

/// <summary>
/// Applied engine configuration snapshot (post Load/Apply). Source of truth for Sessions.
/// </summary>
public interface IConfigurationService
{
    EngineConfiguration GetCurrent();

    JournalEventsConfiguration GetJournalEvents();

    bool AreMandatorySettingsSatisfied { get; }

    IReadOnlyList<string> MissingRequired { get; }

    /// <summary>Replaces the in-memory applied snapshot after Load or section Apply.</summary>
    void ReplaceApplied(
        EngineConfiguration configuration,
        JournalEventsConfiguration journalEvents,
        IReadOnlyList<string> missingRequired);
}

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
