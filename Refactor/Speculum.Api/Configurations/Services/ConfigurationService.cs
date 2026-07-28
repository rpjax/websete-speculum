using Speculum.Api.Configurations.Models.Journal;
using Speculum.Api.Configurations.Services.Contracts;

namespace Speculum.Api.Configurations.Services;

public sealed class ConfigurationService : IConfigurationService
{
    private readonly object _gate = new();
    private EngineConfiguration _current = new();
    private JournalEventsConfiguration _journal = new();
    private IReadOnlyList<string> _missingRequired =
    [
        ConfigSectionDisplay.Navigation,
        ConfigSectionDisplay.Sessions,
        ConfigSectionDisplay.ResourceManagement,
    ];

    public bool AreMandatorySettingsSatisfied
    {
        get
        {
            lock (_gate)
            {
                return _missingRequired.Count == 0;
            }
        }
    }

    public IReadOnlyList<string> MissingRequired
    {
        get
        {
            lock (_gate)
            {
                return _missingRequired;
            }
        }
    }

    public EngineConfiguration GetCurrent()
    {
        lock (_gate)
        {
            return Clone(_current);
        }
    }

    public JournalEventsConfiguration GetJournalEvents()
    {
        lock (_gate)
        {
            return new JournalEventsConfiguration
            {
                Events = new Dictionary<string, bool>(_journal.Events, StringComparer.Ordinal),
            };
        }
    }

    public void ReplaceApplied(
        EngineConfiguration configuration,
        JournalEventsConfiguration journalEvents,
        IReadOnlyList<string> missingRequired)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(journalEvents);
        ArgumentNullException.ThrowIfNull(missingRequired);

        lock (_gate)
        {
            _current = Clone(configuration);
            _journal = new JournalEventsConfiguration
            {
                Events = new Dictionary<string, bool>(journalEvents.Events, StringComparer.Ordinal),
            };
            _missingRequired = missingRequired.ToArray();
        }
    }

    private static EngineConfiguration Clone(EngineConfiguration source)
        => new()
        {
            Hosting = source.Hosting,
            Navigation = source.Navigation,
            Sessions = source.Sessions,
            Profiles = source.Profiles,
            ResourceManagement = source.ResourceManagement,
            Scripting = source.Scripting,
            Diagnostics = source.Diagnostics,
            Telemetry = source.Telemetry,
        };
}
