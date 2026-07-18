using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserProfiles.Aggregates;
using Speculum.Api.BrowserSessions.Models;

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
/// After close, <see cref="IBrowserClient.TryGetConnection"/> fails for this session id, and
/// subsequent command/stream calls on this instance fail.
/// </para>
/// <para>
/// Typical start order: <see cref="LaunchBrowserAsync"/> → <see cref="RestoreProfileStateAsync"/> →
/// <see cref="NavigateAsync"/>. Typical stop order: <see cref="ExportSessionStateAsync"/> →
/// <see cref="StopBrowserAsync"/> → <see cref="CloseAsync"/>. Persisting exported state into a
/// <see cref="Profile"/> is outside this boundary.
/// </para>
/// </remarks>
public interface ISessionConnection
{
    /// <summary>
    /// Closes the connection (<c>CloseConnection</c> phase): cancels work, releases resources,
    /// and deregisters from <see cref="IBrowserClient"/>. Idempotent.
    /// </summary>
    Task<IResult> CloseAsync(CancellationToken ct = default);

    /// <summary>
    /// Launches the browser process for this session (<c>LaunchBrowser</c> phase).
    /// On success the session is ready to accept restore, navigate, and stream/command traffic.
    /// </summary>
    Task<IResult> LaunchBrowserAsync(
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
    /// and later navigations).
    /// </summary>
    Task<IResult> NavigateAsync(
        string url,
        CancellationToken ct = default);

    /// <summary>Frame stream from the sidecar screencast path.</summary>
    IResult<ChannelReader<Frame>> GetFrameReader();

    /// <summary>Console output stream from the live browser.</summary>
    IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputReader();

    /// <summary>Session status / lifecycle signals from the sidecar.</summary>
    IResult<ChannelReader<SessionStatus>> GetStatusReader();

    /// <summary>
    /// Pumps user input from <paramref name="channelReader"/> into the sidecar until the
    /// channel completes or the connection closes.
    /// </summary>
    IResult<Task> ConsumeUserInputAsync(ChannelReader<string> channelReader);

    /// <summary>
    /// Pumps console input from <paramref name="channelReader"/> into the sidecar until the
    /// channel completes or the connection closes.
    /// </summary>
    IResult<Task> ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader);
}
