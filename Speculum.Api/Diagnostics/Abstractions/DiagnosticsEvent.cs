namespace Speculum.Api.Diagnostics.Abstractions;

/// <summary>
/// Catalog metadata for a diagnostics event. The transport gates purely on this
/// descriptor + settings — no hardcoded domain/event names in the bus.
/// </summary>
public sealed record DiagnosticsEventDescriptor(
    string Name,
    DiagnosticsDomain Domain,
    DiagnosticsCapability Capability,
    bool Persist);

public static class DiagnosticsEventCatalog
{
    public static readonly IReadOnlyList<DiagnosticsEventDescriptor> Descriptors =
    [
        // MotorLive lifecycle — Metric (survives Metrics-only / Degraded cap).
        new("Motor.SessionStarting", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SessionStarted", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SessionResolved", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SessionPromoted", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SessionStopping", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SessionStopped", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SessionStartFailed", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.NavigateRequested", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.NavigateCompleted", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.NavigateRejected", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.UrlMapped", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.DrainStarted", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.DrainCompleted", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SlotAcquired", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SlotReleased", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SidecarConnected", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SidecarDisconnected", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.StateExportRequested", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.StateExportCompleted", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.StateExportFailed", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        // MotorLive detail — Event (emit-gated; dropped under Degraded).
        new("Motor.ResizeRequested", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Event, true),
        new("Motor.SidecarFaulted", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Event, true),
        // Noisy status mirror — Metric, ring-only (never persisted).
        new("Motor.StatusMirrored", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, false),
        // Sidecar / BrowserQuery probes — Metric-equiv (gated by Sidecar.Metrics).
        new("Sidecar.DiagProbeRequested", DiagnosticsDomain.SidecarBrowser, DiagnosticsCapability.Metric, true),
        new("Sidecar.DiagProbeCompleted", DiagnosticsDomain.SidecarBrowser, DiagnosticsCapability.Metric, true),
        new("Sidecar.DiagProbeTimedOut", DiagnosticsDomain.SidecarBrowser, DiagnosticsCapability.Metric, true),
        new("Sidecar.DiagProbeRejected", DiagnosticsDomain.SidecarBrowser, DiagnosticsCapability.Metric, true),
        // DiagnosticsSelf — always on when Enabled (domain bypasses capability gate).
        new("Diagnostics.ConfigApplied", DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric, true),
        new("Diagnostics.ElevateStarted", DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric, true),
        new("Diagnostics.ElevateExpired", DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric, true),
        new("Diagnostics.StorageOverflow", DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric, true),
        new("Diagnostics.Degraded", DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric, true),
        new("Diagnostics.Recovered", DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric, true),
        new("Diagnostics.CleanupPurged", DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric, true),
        // Telemetry — composite periodic sample.
        new("Telemetry.SampleCollected", DiagnosticsDomain.Telemetry, DiagnosticsCapability.Metric, true),
    ];

    public static readonly string[] All = Descriptors.Select(d => d.Name).ToArray();

    private static readonly IReadOnlyDictionary<string, DiagnosticsEventDescriptor> ByName =
        Descriptors.ToDictionary(d => d.Name, StringComparer.Ordinal);

    public static bool TryGet(string name, out DiagnosticsEventDescriptor descriptor)
        => ByName.TryGetValue(name, out descriptor!);
}

public sealed class DiagnosticsEvent
{
    public int DiagnosticsSchemaVersion { get; init; } = DiagnosticsSchema.Version;
    public string Id { get; init; } = Guid.NewGuid().ToString("N");
    public DateTimeOffset Utc { get; init; } = DateTimeOffset.UtcNow;
    public DiagnosticsDomain Domain { get; init; }
    public string Name { get; init; } = "";
    public DiagnosticsSeverity Severity { get; init; } = DiagnosticsSeverity.Information;
    public string? CorrelationId { get; init; }
    public string? ConnectionId { get; init; }
    public string? PersistedSessionId { get; init; }
    public string? SidecarSessionId { get; init; }
    public object? Payload { get; init; }
}
