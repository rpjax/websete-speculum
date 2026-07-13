namespace Speculum.Api.Diagnostics.Abstractions;

public static class DiagnosticsEventCatalog
{
    public static readonly string[] All =
    [
        // MotorLive
        "Motor.SessionStarting",
        "Motor.SessionStarted",
        "Motor.SessionPromoted",
        "Motor.SessionStopping",
        "Motor.SessionStopped",
        "Motor.SessionStartFailed",
        "Motor.NavigateRequested",
        "Motor.NavigateCompleted",
        "Motor.NavigateRejected",
        "Motor.ResizeRequested",
        "Motor.DrainStarted",
        "Motor.DrainCompleted",
        "Motor.SlotAcquired",
        "Motor.SlotReleased",
        "Motor.SidecarConnected",
        "Motor.SidecarDisconnected",
        "Motor.SidecarFaulted",
        "Motor.StateExportRequested",
        "Motor.StateExportCompleted",
        "Motor.StateExportFailed",
        // Sidecar / BrowserQuery
        "Sidecar.DiagProbeRequested",
        "Sidecar.DiagProbeCompleted",
        "Sidecar.DiagProbeTimedOut",
        "Sidecar.DiagProbeRejected",
        // DiagnosticsSelf
        "Diagnostics.ConfigApplied",
        "Diagnostics.ElevateStarted",
        "Diagnostics.ElevateExpired",
        "Diagnostics.StorageOverflow",
        "Diagnostics.Degraded",
        "Diagnostics.Recovered",
        "Diagnostics.CleanupPurged",
    ];
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
