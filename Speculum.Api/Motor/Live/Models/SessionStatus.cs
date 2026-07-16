using MessagePack;

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
/// MessagePack (and JSON) wire keys are camelCase to match the React client:
///   { tabCount, url, resizing, width, height, fps, uptimeMs,
///     sessionId, jsBridgeEnabled }
/// </summary>
[MessagePackObject]
public sealed class SessionStatus
{
    // ── Sidecar-side ──────────────────────────────────────────────────────────

    /// <summary>
    /// Number of open browser tabs. Must always be exactly 1.
    /// Any other value indicates a tab-enforcement anomaly.
    /// </summary>
    [Key("tabCount")]
    public int TabCount { get; init; }

    /// <summary>Current page URL inside the virtual browser.</summary>
    [Key("url")]
    public string Url { get; init; } = "";

    /// <summary>Whether a resize operation is currently in progress.</summary>
    [Key("resizing")]
    public bool Resizing { get; init; }

    /// <summary>Active virtual viewport width (px).</summary>
    [Key("width")]
    public int Width { get; init; }

    /// <summary>Active virtual viewport height (px).</summary>
    [Key("height")]
    public int Height { get; init; }

    // ── .NET relay-side ───────────────────────────────────────────────────────

    /// <summary>
    /// Screencast frames received per second, measured by the .NET relay.
    /// </summary>
    [Key("fps")]
    public double Fps { get; init; }

    /// <summary>Session age in milliseconds since <c>StartAsync</c>.</summary>
    [Key("uptimeMs")]
    public long UptimeMs { get; init; }

    /// <summary>Sidecar session identifier (first 8 hex chars shown in logs).</summary>
    [Key("sessionId")]
    public string SessionId { get; init; } = "";

    /// <summary>Whether the JsBridge (vcon / console forwarding) is enabled.</summary>
    [Key("jsBridgeEnabled")]
    public bool JsBridgeEnabled { get; init; }

    /// <summary>Remote editable focus state for virtual keyboard / IME.</summary>
    [Key("editing")]
    public EditingState? Editing { get; init; }
}

[MessagePackObject]
public sealed class EditingState
{
    [Key("focused")]
    public bool Focused { get; init; }

    [Key("inputMode")]
    public string? InputMode { get; init; }

    [Key("multiline")]
    public bool Multiline { get; init; }

    [Key("tagName")]
    public string? TagName { get; init; }
}
