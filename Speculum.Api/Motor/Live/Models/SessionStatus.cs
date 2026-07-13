namespace Speculum.Api.Motor.Live.Models;

/// <summary>
/// Periodic session health snapshot sent to the client via the dedicated
/// <c>OpenStatusChannel</c> SignalR stream.
///
/// Sidecar-side fields (tabCount, url, resizing, width, height) come from
/// the MSG_STATUS (0x09) binary frame published every 1 s by the sidecar.
/// .NET-side fields (fps, uptimeMs, sessionId, jsBridgeEnabled) are added
/// by <c>MotorSession</c> before the snapshot is placed in the status channel.
///
/// SignalR serialises this as a camelCase JSON object:
///   { tabCount, url, resizing, width, height, fps, uptimeMs,
///     sessionId, jsBridgeEnabled }
/// </summary>
public sealed class SessionStatus
{
    // ── Sidecar-side ──────────────────────────────────────────────────────────

    /// <summary>
    /// Number of open browser tabs. Must always be exactly 1.
    /// Any other value indicates a tab-enforcement anomaly.
    /// </summary>
    public int    TabCount  { get; init; }

    /// <summary>Current page URL inside the virtual browser.</summary>
    public string Url       { get; init; } = "";

    /// <summary>Whether a resize operation is currently in progress.</summary>
    public bool   Resizing  { get; init; }

    /// <summary>Active virtual viewport width (px).</summary>
    public int    Width     { get; init; }

    /// <summary>Active virtual viewport height (px).</summary>
    public int    Height    { get; init; }

    // ── .NET relay-side ───────────────────────────────────────────────────────

    /// <summary>
    /// Screencast frames received per second, measured by the .NET relay.
    /// </summary>
    public double Fps             { get; init; }

    /// <summary>Session age in milliseconds since <c>StartAsync</c>.</summary>
    public long   UptimeMs        { get; init; }

    /// <summary>Sidecar session identifier (first 8 hex chars shown in logs).</summary>
    public string SessionId       { get; init; } = "";

    /// <summary>Whether the JsBridge (vcon / console forwarding) is enabled.</summary>
    public bool   JsBridgeEnabled { get; init; }
}
