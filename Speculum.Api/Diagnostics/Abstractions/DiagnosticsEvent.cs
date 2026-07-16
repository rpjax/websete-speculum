namespace Speculum.Api.Diagnostics.Abstractions;

/// <summary>
/// Catalog metadata for a diagnostics event. The transport gates purely on this
/// descriptor + settings — no hardcoded domain/event names in the bus.
/// <para>
/// Span metadata (<see cref="SpanRole"/>/<see cref="SpanKey"/>/<see cref="SpanTimeoutSec"/>)
/// is optional: when set, the pipeline pairs Open/Close beats into a span on the timeline.
/// </para>
/// </summary>
public sealed record DiagnosticsEventDescriptor(
    string Name,
    DiagnosticsDomain Domain,
    DiagnosticsCapability Capability,
    bool Persist,
    SpanRole SpanRole = SpanRole.None,
    string? SpanKey = null,
    int SpanTimeoutSec = 0);

public static class DiagnosticsEventCatalog
{
    /// <summary>Stable span keys. Every key must have at least one Open and one Close descriptor.</summary>
    public static class SpanKeys
    {
        public const string MotorSession = "motor.session";
        public const string MotorNavigate = "motor.navigate";
        public const string MotorExport = "motor.export";
        public const string MotorDrain = "motor.drain";
        public const string SidecarProbe = "sidecar.probe";
    }

    private const int NavigateTimeoutSec = 60;
    private const int ExportTimeoutSec = 60;
    private const int DrainTimeoutSec = 120;
    private const int ProbeTimeoutSec = 30;

    public static readonly IReadOnlyList<DiagnosticsEventDescriptor> Descriptors =
    [
        // MotorLive lifecycle — Metric (survives Metrics-only / Degraded cap).
        // motor.session span: Starting -> {Stopped | StartFailed | Refused}. No timeout (sessions
        // are long-lived; teardown closes leftover scopes on disconnect/drain).
        new("Motor.SessionStarting", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true,
            SpanRole.Open, SpanKeys.MotorSession),
        new("Motor.SessionStarted", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SessionResolved", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SessionPromoted", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SessionStopping", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SessionStopped", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true,
            SpanRole.Close, SpanKeys.MotorSession),
        new("Motor.SessionStartFailed", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true,
            SpanRole.Close, SpanKeys.MotorSession),
        new("Motor.SessionRefused", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true,
            SpanRole.Close, SpanKeys.MotorSession),
        // motor.navigate span: Requested -> {Completed | Rejected}. NavigateBlocked fires in the
        // build-target catch BEFORE Requested opens the span, so it is a standalone beat (never a
        // close) — tagging it Close would orphan-close or, worse, close an unrelated in-flight nav.
        new("Motor.NavigateRequested", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true,
            SpanRole.Open, SpanKeys.MotorNavigate, NavigateTimeoutSec),
        new("Motor.NavigateCompleted", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true,
            SpanRole.Close, SpanKeys.MotorNavigate),
        new("Motor.NavigateRejected", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true,
            SpanRole.Close, SpanKeys.MotorNavigate),
        new("Motor.NavigateBlocked", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.UrlMapped", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        // motor.drain span: DrainStarted -> DrainCompleted.
        new("Motor.DrainStarted", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true,
            SpanRole.Open, SpanKeys.MotorDrain, DrainTimeoutSec),
        new("Motor.DrainCompleted", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true,
            SpanRole.Close, SpanKeys.MotorDrain),
        new("Motor.SlotAcquired", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SlotReleased", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SidecarConnected", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        new("Motor.SidecarDisconnected", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true),
        // motor.export span: StateExportRequested -> {Completed | Failed}.
        new("Motor.StateExportRequested", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true,
            SpanRole.Open, SpanKeys.MotorExport, ExportTimeoutSec),
        new("Motor.StateExportCompleted", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true,
            SpanRole.Close, SpanKeys.MotorExport),
        new("Motor.StateExportFailed", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, true,
            SpanRole.Close, SpanKeys.MotorExport),
        // MotorLive detail — Event (emit-gated; dropped under Degraded).
        new("Motor.ResizeRequested", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Event, true),
        new("Motor.SidecarFaulted", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Event, true),
        // Noisy status mirror — Metric, ring-only (never persisted).
        new("Motor.StatusMirrored", DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, false),
        // Sidecar / BrowserQuery probes — Metric-equiv (gated by Sidecar.Metrics).
        // sidecar.probe span: DiagProbeRequested -> {Completed | TimedOut | Rejected}.
        new("Sidecar.DiagProbeRequested", DiagnosticsDomain.SidecarBrowser, DiagnosticsCapability.Metric, true,
            SpanRole.Open, SpanKeys.SidecarProbe, ProbeTimeoutSec),
        new("Sidecar.DiagProbeCompleted", DiagnosticsDomain.SidecarBrowser, DiagnosticsCapability.Metric, true,
            SpanRole.Close, SpanKeys.SidecarProbe),
        new("Sidecar.DiagProbeTimedOut", DiagnosticsDomain.SidecarBrowser, DiagnosticsCapability.Metric, true,
            SpanRole.Close, SpanKeys.SidecarProbe),
        new("Sidecar.DiagProbeRejected", DiagnosticsDomain.SidecarBrowser, DiagnosticsCapability.Metric, true,
            SpanRole.Close, SpanKeys.SidecarProbe),
        // Concurrency-gate refusal fires BEFORE a probe span opens (the connection already has one
        // in flight), so it is a standalone beat — never a close, or it would shut the in-flight
        // probe's span. It nests under that open probe via causationId (same connection scope).
        new("Sidecar.DiagProbeBusy", DiagnosticsDomain.SidecarBrowser, DiagnosticsCapability.Metric, true),
        // DiagnosticsSelf — always on when Enabled (domain bypasses capability gate).
        new("Diagnostics.ConfigApplied", DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric, true),
        new("Diagnostics.ElevateStarted", DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric, true),
        new("Diagnostics.ElevateExpired", DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric, true),
        new("Diagnostics.StorageOverflow", DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric, true),
        new("Diagnostics.Degraded", DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric, true),
        new("Diagnostics.Recovered", DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric, true),
        new("Diagnostics.CleanupPurged", DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric, true),
        // Synthetic close for spans abandoned by timeout / teardown / boot recovery. SpanKey is
        // set dynamically at emit time (echoes the abandoned span's key + id).
        new("Diagnostics.SpanAbandoned", DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric, true,
            SpanRole.Close),
        // Telemetry — composite periodic sample (global) + per-live-session projection (opt-in,
        // scoped by ConnectionId so it plots inside a session's story lane).
        new("Telemetry.SampleCollected", DiagnosticsDomain.Telemetry, DiagnosticsCapability.Metric, true),
        new("Telemetry.SessionSampleCollected", DiagnosticsDomain.Telemetry, DiagnosticsCapability.Metric, true),
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

    // --- Span correlation (schema v2). Stamped by the pipeline (SpanTracker) — producers/callers
    // leave these unset. SpanAbandoned pre-sets SpanId/SpanKey so the tracker echoes them verbatim.
    /// <summary>Monotonic, process-wide sequence for deterministic ordering / gap detection.</summary>
    public long Seq { get; set; }

    /// <summary>Id shared by an Open beat and its matching Close beat.</summary>
    public string? SpanId { get; set; }

    /// <summary>Logical span type (e.g. <c>motor.navigate</c>); echoed onto the Close beat.</summary>
    public string? SpanKey { get; set; }

    /// <summary>For standalone beats: the SpanId of the innermost open span in the same scope.</summary>
    public string? CausationId { get; set; }
}
