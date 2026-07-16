namespace Speculum.Api.Diagnostics.Abstractions;

public static class DiagnosticsSchema
{
    /// <summary>
    /// v2 adds span correlation to the envelope (<c>SpanId</c>/<c>SpanKey</c>/<c>Seq</c>/<c>CausationId</c>)
    /// stamped by the pipeline. Wire is additive: v1 readers ignore the new fields.
    /// </summary>
    public const int Version = 2;
}

/// <summary>
/// The role an event plays in a span (a paired open/close operation on the timeline).
/// Metadata per event via the catalog descriptor — the pipeline mints/echoes the span id.
/// </summary>
public enum SpanRole
{
    /// <summary>Standalone beat; correlated to the innermost open span via CausationId.</summary>
    None,

    /// <summary>Opens a span: the pipeline mints a fresh SpanId keyed by (scope, SpanKey).</summary>
    Open,

    /// <summary>Closes a span: the pipeline echoes the matching open SpanId and clears it.</summary>
    Close,
}

/// <summary>
/// The kind of signal an event carries. Metadata per event (via the catalog descriptor),
/// NOT an operator control — operators toggle capabilities per domain in config.
/// Mirrors the Signal vocabulary in docs/diagnostics.md.
/// </summary>
public enum DiagnosticsCapability
{
    Metric,
    Event,
    Snapshot,
    Probe,
}

public enum DiagnosticsDomain
{
    MotorLive,
    SidecarBrowser,
    BrowserQuery,
    PersistedSessions,
    Telemetry,
    DiagnosticsSelf,
}

public enum DiagnosticsSeverity
{
    Information,
    Warning,
    Error,
}

public enum MotorSessionPhase
{
    Starting,
    Running,
    Stopping,
    Stopped,
}
