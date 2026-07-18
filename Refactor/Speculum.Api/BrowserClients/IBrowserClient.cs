using System.Diagnostics.CodeAnalysis;
using Aidan.Core.Patterns;

namespace Speculum.Api.BrowserClients;

/// <summary>
/// Sidecar boundary: registry and factory for internal API↔sidecar session connections.
/// </summary>
/// <remarks>
/// <para>
/// Domain language is start/stop of a live session. This port owns transport and
/// process control toward the sidecar; presentation layers must not depend on it directly.
/// </para>
/// <para>
/// A session connection is either registered and operational, or unavailable. There is at most
/// one connection per session id. When the connection dies, the live session is treated as gone
/// so the sidecar can dispose its browser instance without pooling.
/// </para>
/// <para>
/// Multi-actor attachment (SignalR/WebTransport pooling) is an API concern. From the sidecar's
/// perspective there is a single connection per session.
/// </para>
/// </remarks>
public interface IBrowserClient
{
    /// <summary>
    /// Attempts to resolve the operational connection for <paramref name="sessionId"/>.
    /// </summary>
    /// <param name="sessionId">Live session id.</param>
    /// <param name="connection">
    /// The connection when the method returns <see langword="true"/>; otherwise <see langword="null"/>.
    /// </param>
    /// <returns>
    /// <see langword="true"/> when a registered, operational connection exists;
    /// <see langword="false"/> when the session has no connection or it has been closed.
    /// </returns>
    bool TryGetConnection(
        Guid sessionId,
        [NotNullWhen(true)] out ISessionConnection? connection);

    /// <summary>
    /// Applies global browser/sidecar configuration that is not scoped to a single session.
    /// </summary>
    Task<IResult> UpdateBrowserConfigsAsync(CancellationToken ct = default);

    /// <summary>
    /// Opens and registers the internal sidecar connection for <paramref name="sessionId"/>
    /// (<c>StartConnection</c> phase). Does not launch the browser.
    /// </summary>
    /// <param name="sessionId">Id that will identify this live session and its connection.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>
    /// Success with the registered connection, or failure if a connection already exists for
    /// <paramref name="sessionId"/> or the sidecar handshake fails.
    /// </returns>
    Task<IResult<ISessionConnection>> StartConnectionAsync(
        Guid sessionId,
        CancellationToken ct = default);
}
