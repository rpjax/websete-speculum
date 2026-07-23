using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.BrowserClients;

/// <summary>
/// Internal API↔sidecar connection for a single live session.
/// </summary>
/// <remarks>
/// <para>
/// Commands and streams are scoped to this connection. Callers obtain an instance from
/// <see cref="IBrowserClient.StartConnectionAsync"/> or <see cref="IBrowserClient.TryGetConnection"/>;
/// the connection is not a DI singleton.
/// </para>
/// <para>
/// <see cref="CloseAsync"/> is idempotent. It atomically prevents new operations, cancels pending
/// operations, releases resources, and deregisters the connection from <see cref="IBrowserClient"/>.
/// After close, <see cref="IBrowserClient.TryGetConnection"/> fails for this session id,
/// <see cref="IsOpen"/> is false, and subsequent command/stream calls on this instance fail.
/// Stream readers complete when the connection faults or closes.
/// </para>
/// <para>
/// Typical start order: <see cref="LaunchBrowserAsync"/> → <see cref="RestoreProfileStateAsync"/> →
/// <see cref="NavigateAsync"/>. Typical stop order: <see cref="ExportSessionStateAsync"/> →
/// <see cref="StopBrowserAsync"/> → <see cref="CloseAsync"/>. Persisting exported state into a
/// <see cref="Profile"/> is outside this boundary.
/// </para>
/// <para>
/// Not on this port: connection registry (<see cref="IBrowserClient"/>), session slots/pipes,
/// client↔target URL mapping / business allowlist, profile merge/persist, Journal emit,
/// Diagnostics capability gating, or hub/SignalR binding. History (<c>goback</c>/<c>goforward</c>)
/// travels as validated user-input JSON via <see cref="ConsumeUserInputAsync"/>.
/// </para>
/// <para>
/// Informative sidecar signals (location, navigation blocked, editable focus, crash) arrive on
/// <see cref="GetNotificationReader"/>. Permission request/response uses dedicated async handlers
/// (<see cref="SetCameraPermissionHandler"/> / <see cref="SetMicrophonePermissionHandler"/>);
/// without a handler the default is deny.
/// </para>
/// </remarks>
public interface ISessionConnection
{
    /// <summary>Live session id this connection is bound to.</summary>
    Guid SessionId { get; }

    /// <summary>
    /// True while the connection accepts commands and streams.
    /// Becomes false after <see cref="CloseAsync"/> or an unrecoverable sidecar fault.
    /// </summary>
    bool IsOpen { get; }

    /// <summary>
    /// Closes the connection (<c>CloseConnection</c> phase): cancels work, releases resources,
    /// and deregisters from <see cref="IBrowserClient"/>. Idempotent.
    /// </summary>
    Task<IResult> CloseAsync(CancellationToken ct = default);

    /// <summary>
    /// Launches the browser process for this session (<c>LaunchBrowser</c> phase).
    /// On success returns confirmed geometry from the sidecar <c>ready</c> handshake.
    /// </summary>
    Task<IResult<BrowserReadyInfo>> LaunchBrowserAsync(
        SessionConfig? configuration,
        CancellationToken ct = default);

    /// <summary>
    /// Stops the browser process for this session (<c>CloseBrowser</c> phase).
    /// Does not close the sidecar connection; call <see cref="CloseAsync"/> separately.
    /// </summary>
    Task<IResult> StopBrowserAsync(CancellationToken ct = default);

    /// <summary>
    /// Exports durable state from the live browser (<c>ExportSessionState</c> phase).
    /// </summary>
    /// <returns>
    /// Session-scoped export payload. Merging into <see cref="ProfileState"/> is the
    /// caller's responsibility (<c>PersistSessionState</c>).
    /// </returns>
    Task<IResult<SessionState>> ExportSessionStateAsync(CancellationToken ct = default);

    /// <summary>
    /// Applies profile state into the live browser (<c>RestoreProfileState</c> phase).
    /// </summary>
    /// <param name="state">State carried by the resolved <see cref="Profile"/>.</param>
    Task<IResult> RestoreProfileStateAsync(
        ProfileState state,
        CancellationToken ct = default);

    /// <summary>
    /// Navigates the live browser to <paramref name="url"/> (used for <c>InitialNavigation</c>
    /// and later navigations). The URL must already be validated/mapped by the caller.
    /// </summary>
    Task<IResult> NavigateAsync(
        string url,
        CancellationToken ct = default);

    /// <summary>Reloads the current page (<c>refresh</c> wire command).</summary>
    Task<IResult> RefreshAsync(CancellationToken ct = default);

    /// <summary>
    /// Correlated viewport resize (<c>resize</c> / <c>resizeResult</c>).
    /// </summary>
    Task<IResult<ResizeResult>> ResizeAsync(
        string requestId,
        int width,
        int height,
        DeviceProfile device,
        CancellationToken ct = default);

    /// <summary>
    /// Runs a sidecar diagnostics probe (<c>diagProbe</c> / <c>diagResult</c>).
    /// Capability toggles and concurrency budgets are applied by Diagnostics above this port.
    /// </summary>
    Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
        DiagProbeRequest request,
        CancellationToken ct = default);

    /// <summary>Frame stream from the sidecar screencast path.</summary>
    IResult<ChannelReader<Frame>> GetFrameReader();

    /// <summary>Console output stream from the live browser.</summary>
    IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputReader();

    /// <summary>
    /// Session status from the sidecar (polled GetStatus + optional last-known editing).
    /// Relay fields (fps, uptime, jsBridge) may be filled by pipe/session layers above.
    /// </summary>
    IResult<ChannelReader<SessionStatus>> GetStatusReader();

    /// <summary>
    /// Informative notifications: location, navigation blocked, editable focus, crash.
    /// DropOldest channel; does not include video/console/status.
    /// </summary>
    IResult<ChannelReader<SessionNotification>> GetNotificationReader();

    /// <summary>
    /// Registers the async handler for camera permission requests from the page.
    /// Without a handler, requests are denied.
    /// </summary>
    void SetCameraPermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler);

    /// <summary>
    /// Registers the async handler for microphone permission requests from the page.
    /// Without a handler, requests are denied.
    /// </summary>
    void SetMicrophonePermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler);

    /// <summary>
    /// Pumps opaque user-input JSON from <paramref name="channelReader"/> into the sidecar
    /// until the channel completes or the connection closes.
    /// </summary>
    IResult<Task> ConsumeUserInputAsync(ChannelReader<string> channelReader);

    /// <summary>
    /// Pumps console input from <paramref name="channelReader"/> into the sidecar until the
    /// channel completes or the connection closes.
    /// </summary>
    IResult<Task> ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader);
}
