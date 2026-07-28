using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Diagnostics;
using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Journal;
using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Models.Profiles;
using Speculum.Api.Configurations.Models.ResourceManagement;
using Speculum.Api.Configurations.Models.Scripting;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Configurations.Models.Telemetry;
using Speculum.Api.Configurations.Persistence;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Telemetry;

namespace Speculum.Api.Configurations.Services;

public interface IConfigurationApplyService
{
    Task ApplyAllFromStoreAsync(CancellationToken ct = default);

    Task ApplySectionAsync(string sectionKey, CancellationToken ct = default);

    /// <summary>Persist JSON then apply one section. Returns error message on failure.</summary>
    Task<string?> PutAndApplyAsync(string sectionKey, string? valueJson, CancellationToken ct = default);

    /// <summary>
    /// Validate all sections, then persist every section and apply once.
    /// Returns the first validation error without writing when any section is invalid.
    /// </summary>
    Task<string?> PutManyAndApplyAsync(
        IReadOnlyList<(string SectionKey, string ValueJson)> sections,
        CancellationToken ct = default);
}

public sealed class ConfigurationApplyService : IConfigurationApplyService
{
    private static readonly JsonSerializerOptions JsonOptions = ConfigSectionStore.SerializerOptions;

    private readonly SemaphoreSlim _applyGate = new(1, 1);
    private readonly IConfigSectionStore _store;
    private readonly IConfigurationService _configuration;
    private readonly IJournalCatalog _journalCatalog;
    private readonly IOptionsMonitor<ProfilesConfiguration> _profiles;
    private readonly IOptionsMonitor<ScriptingConfiguration> _scripting;
    private readonly IOptionsMonitor<DiagnosticsConfiguration> _diagnostics;
    private readonly ILogger<ConfigurationApplyService> _logger;

    public ConfigurationApplyService(
        IConfigSectionStore store,
        IConfigurationService configuration,
        IJournalCatalog journalCatalog,
        IOptionsMonitor<ProfilesConfiguration> profiles,
        IOptionsMonitor<ScriptingConfiguration> scripting,
        IOptionsMonitor<DiagnosticsConfiguration> diagnostics,
        ILogger<ConfigurationApplyService> logger)
    {
        _store = store;
        _configuration = configuration;
        _journalCatalog = journalCatalog;
        _profiles = profiles;
        _scripting = scripting;
        _diagnostics = diagnostics;
        _logger = logger;
    }

    public async Task ApplyAllFromStoreAsync(CancellationToken ct = default)
    {
        await _applyGate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            await ApplyAllFromStoreUnlockedAsync(ct).ConfigureAwait(false);
        }
        finally
        {
            _applyGate.Release();
        }
    }

    public async Task ApplySectionAsync(string sectionKey, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sectionKey);
        await ApplyAllFromStoreAsync(ct).ConfigureAwait(false);
    }

    public async Task<string?> PutAndApplyAsync(
        string sectionKey,
        string? valueJson,
        CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sectionKey);
        var key = NormalizeKey(sectionKey);
        if (key is null)
            return $"Unknown configuration section '{sectionKey}'.";

        var error = ValidateSectionJson(key, valueJson);
        if (error is not null)
            return error;

        await _applyGate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var persistedJson = await MergePutJsonAsync(key, valueJson!, ct).ConfigureAwait(false);
            await _store.UpsertSectionJsonAsync(key, persistedJson, ct).ConfigureAwait(false);
            await ApplyAllFromStoreUnlockedAsync(ct).ConfigureAwait(false);
            return null;
        }
        finally
        {
            _applyGate.Release();
        }
    }

    public async Task<string?> PutManyAndApplyAsync(
        IReadOnlyList<(string SectionKey, string ValueJson)> sections,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(sections);
        if (sections.Count == 0)
            return "At least one configuration section is required.";

        var normalized = new List<(string Key, string Json)>(sections.Count);
        foreach (var (sectionKey, valueJson) in sections)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(sectionKey);
            if (string.IsNullOrWhiteSpace(valueJson))
                return $"JSON body is required for section '{sectionKey}'.";

            var key = NormalizeKey(sectionKey);
            if (key is null)
                return $"Unknown configuration section '{sectionKey}'.";

            var error = ValidateSectionJson(key, valueJson);
            if (error is not null)
                return $"{key}: {error}";

            normalized.Add((key, valueJson));
        }

        await _applyGate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            foreach (var (key, json) in normalized)
            {
                var persistedJson = await MergePutJsonAsync(key, json, ct).ConfigureAwait(false);
                await _store.UpsertSectionJsonAsync(key, persistedJson, ct).ConfigureAwait(false);
            }

            await ApplyAllFromStoreUnlockedAsync(ct).ConfigureAwait(false);
            return null;
        }
        finally
        {
            _applyGate.Release();
        }
    }

    private async Task ApplyAllFromStoreUnlockedAsync(CancellationToken ct)
    {
        EngineConfiguration engine;
        JournalEventsConfiguration journal;
        try
        {
            (engine, journal) = await BuildSnapshotFromStoreAsync(ct).ConfigureAwait(false);
        }
        catch (InvalidOperationException ex)
        {
            // Corrupt SQLite must not brick process boot — stay pending until operators repair via API.
            _logger.LogError(
                ex,
                "Failed to deserialize configuration snapshot; applying empty engine (pending-config).");
            engine = new EngineConfiguration();
            journal = new JournalEventsConfiguration();
        }

        try
        {
            ApplyJournal(journal);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(
                ex,
                "Journal apply rejected persisted events; disabling all non-canonical types.");
            DisableAllNonCanonicalJournalTypes();
        }

        // Telemetry-owned facts follow TelemetryConfiguration, not the Journal events map.
        TelemetryJournalFacts.ApplyToCatalog(_journalCatalog, engine.Telemetry);

        var missing = ConfigurationCompleteness.MissingRequired(engine);
        _configuration.ReplaceApplied(engine, journal, missing);

        if (missing.Count == 0)
        {
            _logger.LogInformation("Configuration apply complete; mandatory settings satisfied.");
        }
        else
        {
            _logger.LogWarning(
                "Pending config mode. Missing: {Missing}",
                string.Join(", ", missing));
        }
    }

    private void DisableAllNonCanonicalJournalTypes()
    {
        foreach (var descriptor in _journalCatalog.Types)
        {
            if (descriptor.IsCanonical)
                continue;

            _journalCatalog.SetEnabled(descriptor.Type, false);
        }
    }

    private async Task<(EngineConfiguration Engine, JournalEventsConfiguration Journal)>
        BuildSnapshotFromStoreAsync(CancellationToken ct)
    {
        var hosting = await DeserializeOrThrowAsync<HostingConfiguration>(
            ConfigSectionKeys.Hosting, ct).ConfigureAwait(false);
        var navigation = await DeserializeOrThrowAsync<NavigationConfiguration>(
            ConfigSectionKeys.Navigation, ct).ConfigureAwait(false);
        var sessions = await DeserializeOrThrowAsync<SessionsConfiguration>(
            ConfigSectionKeys.Sessions, ct).ConfigureAwait(false);
        var resources = await DeserializeOrThrowAsync<ResourceManagementConfiguration>(
            ConfigSectionKeys.ResourceManagement, ct).ConfigureAwait(false);
        var journal = await DeserializeOrThrowAsync<JournalEventsConfiguration>(
            ConfigSectionKeys.Journal, ct).ConfigureAwait(false);
        var telemetry = await DeserializeOrThrowAsync<TelemetryConfiguration>(
            ConfigSectionKeys.Telemetry, ct).ConfigureAwait(false);

        return (
            new EngineConfiguration
            {
                Hosting = hosting,
                Navigation = navigation,
                Sessions = sessions,
                ResourceManagement = resources,
                Profiles = _profiles.CurrentValue,
                Scripting = _scripting.CurrentValue,
                Diagnostics = _diagnostics.CurrentValue,
                Telemetry = telemetry,
            },
            journal);
    }

    private void ApplyJournal(JournalEventsConfiguration journal)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var descriptor in _journalCatalog.Types)
        {
            if (!seen.Add(descriptor.Type))
                continue;

            if (descriptor.IsCanonical)
                continue;

            // Owned by Telemetry Apply — leave untouched until ApplyTelemetryJournalFacts.
            if (TelemetryJournalFacts.Owns(descriptor.Type))
                continue;

            var enabled = journal.Events.TryGetValue(descriptor.Type, out var flag) && flag;
            _journalCatalog.SetEnabled(descriptor.Type, enabled);
        }

        foreach (var (type, _) in journal.Events)
        {
            if (string.IsNullOrWhiteSpace(type))
                continue;

            if (_journalCatalog.IsCanonical(type))
            {
                throw new InvalidOperationException(
                    $"Cannot apply enablement for canonical Journal fact type '{type}'.");
            }

            if (TelemetryJournalFacts.Owns(type))
            {
                throw new InvalidOperationException(
                    $"Cannot apply Journal enablement for Telemetry-owned fact type '{type}'. " +
                    "Use the Telemetry configuration section instead.");
            }

            if (!_journalCatalog.Types.Any(d => string.Equals(d.Type, type, StringComparison.Ordinal)))
            {
                throw new InvalidOperationException(
                    $"Cannot apply enablement for unknown Journal fact type '{type}'.");
            }
        }
    }

    private async Task<T> DeserializeOrThrowAsync<T>(string key, CancellationToken ct)
        where T : new()
    {
        var json = await _store.GetSectionJsonAsync(key, ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(json))
            return new T();

        try
        {
            return JsonSerializer.Deserialize<T>(json, JsonOptions)
                ?? throw new InvalidOperationException(
                    $"Config section '{key}' deserialized to null.");
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException(
                $"Failed to deserialize config section '{key}': {ex.Message}",
                ex);
        }
    }

    private static string? NormalizeKey(string sectionKey)
    {
        foreach (var key in ConfigSectionKeys.AllEngineSections)
        {
            if (string.Equals(sectionKey, key, StringComparison.Ordinal))
                return key;
        }

        return null;
    }

    private string? ValidateSectionJson(string key, string? valueJson)
    {
        if (string.IsNullOrWhiteSpace(valueJson))
            return null;

        try
        {
            return key switch
            {
                ConfigSectionKeys.Hosting => ValidateHosting(valueJson),
                ConfigSectionKeys.Navigation => ValidateNavigation(valueJson),
                ConfigSectionKeys.Sessions => ValidateSessions(valueJson),
                ConfigSectionKeys.ResourceManagement => ValidateResources(valueJson),
                ConfigSectionKeys.Journal => ValidateJournal(valueJson),
                ConfigSectionKeys.Telemetry => ValidateTelemetry(valueJson),
                _ => "Unknown section.",
            };
        }
        catch (JsonException ex)
        {
            return $"Invalid JSON: {ex.Message}";
        }
    }

    private static string? ValidateHosting(string json)
    {
        var hosting = JsonSerializer.Deserialize<HostingConfiguration>(json, JsonOptions)
            ?? new HostingConfiguration();
        return ConfigurationCompleteness.IsHostingValid(hosting)
            ? null
            : "Hosting domains are invalid.";
    }

    private static string? ValidateNavigation(string json)
    {
        var navigation = JsonSerializer.Deserialize<NavigationConfiguration>(json, JsonOptions)
            ?? new NavigationConfiguration();
        var host = navigation.DefaultTargetHost.Trim();
        if (string.IsNullOrEmpty(host))
            return null;

        return Uri.TryCreate($"https://{host}", UriKind.Absolute, out var uri)
            && string.Equals(uri.Host, host, StringComparison.OrdinalIgnoreCase)
            ? null
            : "Navigation.DefaultTargetHost must be a valid host without a scheme or path.";
    }

    private static string? ValidateSessions(string json)
    {
        var sessions = JsonSerializer.Deserialize<SessionsConfiguration>(json, JsonOptions)
            ?? new SessionsConfiguration();

        if (IsSessionsEmpty(sessions))
            return null;

        var result = new SessionsConfigurationValidator()
            .Validate(Options.DefaultName, sessions);
        return result.Succeeded
            ? null
            : string.Join("; ", result.Failures ?? Array.Empty<string>());
    }

    private static string? ValidateResources(string json)
    {
        var resources = JsonSerializer.Deserialize<ResourceManagementConfiguration>(json, JsonOptions)
            ?? new ResourceManagementConfiguration();
        if (resources.Sessions.MaxConcurrentSessions < 0)
            return "ResourceManagement.Sessions.MaxConcurrentSessions must be >= 0.";
        return null;
    }

    private string? ValidateJournal(string json)
    {
        var journal = JsonSerializer.Deserialize<JournalEventsConfiguration>(json, JsonOptions)
            ?? new JournalEventsConfiguration();
        var shape = ConfigurationCompleteness.ValidateJournalEvents(journal);
        if (shape is not null)
            return shape;

        foreach (var type in journal.Events.Keys)
        {
            if (_journalCatalog.IsCanonical(type))
                return $"Cannot toggle canonical Journal fact type '{type}'.";

            if (TelemetryJournalFacts.Owns(type))
            {
                return $"Cannot toggle Telemetry-owned Journal fact type '{type}' via Journal; " +
                    "use the Telemetry configuration section.";
            }

            if (!_journalCatalog.Types.Any(d =>
                    string.Equals(d.Type, type, StringComparison.Ordinal)))
            {
                return $"Unknown Journal fact type '{type}'.";
            }
        }

        return null;
    }

    private string? ValidateTelemetry(string json)
    {
        var telemetry = JsonSerializer.Deserialize<TelemetryConfiguration>(json, JsonOptions)
            ?? new TelemetryConfiguration();

        if (telemetry.IntervalSeconds is < TelemetryConfiguration.MinIntervalSeconds
            or > TelemetryConfiguration.MaxIntervalSeconds)
            return $"Telemetry.IntervalSeconds must be between {TelemetryConfiguration.MinIntervalSeconds} and {TelemetryConfiguration.MaxIntervalSeconds}.";

        if (telemetry.Host.SampleIntervalMs is < 100 or > 60_000)
            return "Telemetry.Host.SampleIntervalMs must be between 100 and 60000.";

        if (telemetry.ApiProcess.SampleIntervalMs is < 100 or > 60_000)
            return "Telemetry.ApiProcess.SampleIntervalMs must be between 100 and 60000.";

        if (telemetry.Sidecar.TimeoutMs is < 100 or > 60_000)
            return "Telemetry.Sidecar.TimeoutMs must be between 100 and 60000.";

        if (telemetry.Docker.TimeoutMs is < 100 or > 60_000)
            return "Telemetry.Docker.TimeoutMs must be between 100 and 60000.";

        foreach (var type in telemetry.Events.Keys)
        {
            if (string.IsNullOrWhiteSpace(type))
                return "Telemetry.Events keys must be non-empty.";

            if (!TelemetryJournalFacts.Owns(type))
            {
                return $"Telemetry.Events cannot reference non-Telemetry fact type '{type}'.";
            }

            if (type is TelemetryJournalFacts.SampleCollected
                or TelemetryJournalFacts.SessionSampleCollected)
            {
                return $"Telemetry.Events cannot toggle sampling fact '{type}'; use IsEnabled / Sessions.IncludePerSession.";
            }

            if (!_journalCatalog.Types.Any(d =>
                    string.Equals(d.Type, type, StringComparison.Ordinal)))
            {
                return $"Unknown Telemetry event fact type '{type}'.";
            }
        }

        return null;
    }

    private static bool IsSessionsEmpty(SessionsConfiguration sessions)
    {
        var vp = sessions.ViewportPolicy;
        return vp.Minimum.Width == 0
            && vp.Minimum.Height == 0
            && vp.Default.Width == 0
            && vp.Default.Height == 0
            && vp.Maximum.Width == 0
            && vp.Maximum.Height == 0
            && string.IsNullOrWhiteSpace(sessions.ClientEnvironmentPolicy.DefaultLocale);
    }

    /// <summary>
    /// Telemetry PUT merges onto the stored section so partial bodies (e.g. events-only seed)
    /// do not reset sampling toggles or host paths from first-boot env.
    /// </summary>
    private async Task<string> MergePutJsonAsync(
        string key,
        string valueJson,
        CancellationToken ct)
    {
        if (!string.Equals(key, ConfigSectionKeys.Telemetry, StringComparison.Ordinal))
            return valueJson;

        var existing = await _store.GetSectionJsonAsync(key, ct).ConfigureAwait(false);
        return ConfigJsonMerge.MergeTelemetrySectionJson(existing, valueJson);
    }
}
