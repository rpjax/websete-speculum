using Speculum.Api.Diagnostics.Abstractions;

namespace Speculum.Api.Motor.Live;

public sealed class MotorSessionDiagnosticsSnapshot
{
    public string ConnectionId { get; init; } = "";
    public string? PersistedSessionId { get; init; }
    public string SidecarSessionId { get; init; } = "";
    public string? ClientToken { get; init; }
    public string? CorrelationId { get; init; }
    public MotorSessionPhase Phase { get; init; }
    public DateTimeOffset? StartedAt { get; init; }
    public long UptimeMs { get; init; }
    public DateTimeOffset LastEventUtc { get; init; }
    public double Fps { get; init; }
    public long FrameSequence { get; init; }
    public DateTimeOffset? LastFrameUtc { get; init; }
    public int InputQueueApprox { get; init; }
    public int FrameChannelDepth { get; init; }
    public int StatusChannelDepth { get; init; }
    public string CurrentUrl { get; init; } = "";
    public string? LastNavigateResult { get; init; }
    public DateTimeOffset? LastNavigateUtc { get; init; }
    public bool SidecarConnected { get; init; }
    public string? LastFault { get; init; }
    public bool ExportingState { get; init; }
    public string? ForwardingHost { get; init; }
    public bool JsBridgeEnabled { get; init; }
    public int ScriptCount { get; init; }
    public int AllowlistCount { get; init; }
    public string? ProfileDomain { get; init; }
}

public sealed class MotorSessionListItem
{
    public string ConnectionId { get; init; } = "";
    public string? PersistedSessionId { get; init; }
    public string SidecarSessionId { get; init; } = "";
    public MotorSessionPhase Phase { get; init; }
    public string CurrentUrl { get; init; } = "";
    public bool Starting { get; init; }
    /// <summary>Live FPS from the metric-tier snapshot (always available when the session exists).</summary>
    public double Fps { get; init; }
    /// <summary>Session uptime in milliseconds from the metric-tier snapshot.</summary>
    public long UptimeMs { get; init; }
}
