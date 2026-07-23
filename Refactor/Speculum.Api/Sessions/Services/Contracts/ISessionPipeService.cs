using System.Diagnostics.CodeAnalysis;
using Aidan.Core.Patterns;

namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Application port for session pipes: per-consumer I/O handles over a live session.
/// </summary>
/// <remarks>
/// <para>
/// A <see cref="ISessionPipe"/> is not the sidecar connection. There is one
/// <c>ISessionConnection</c> per live session; there may be many pipes (SignalR connections,
/// workers, etc.) fan-out from that connection. Pooling/multiplexing is an API concern.
/// </para>
/// <para>
/// Opening a pipe retains the session in <see cref="ISessionCollector"/> (<c>AddRef</c>);
/// closing releases it (<c>Release</c>). When the last pipe closes, the detached TTL arms again.
/// </para>
/// <para>
/// <see cref="ClosePipe"/> is the only supported way to close a pipe. The pipe instance is
/// marked closed internally so retained references fail subsequent I/O with
/// <c>IResult</c> Failure — callers must not assume removal from this registry alone.
/// </para>
/// <para>
/// Presentation (hubs) depends on this port; it must not depend on <c>IBrowserClient</c> directly.
/// </para>
/// </remarks>
public interface ISessionPipeService
{
    /// <summary>
    /// Opens and registers a pipe for <paramref name="sessionId"/> keyed by <paramref name="pipeId"/>.
    /// </summary>
    /// <param name="sessionId">Live session that already has an active sidecar connection.</param>
    /// <param name="pipeId">
    /// Stable id for this consumer (e.g. transport connection id mapped to a <see cref="Guid"/>).
    /// Must be unique among open pipes.
    /// </param>
    /// <returns>
    /// Success with the new <see cref="ISessionPipe"/>, or Failure if the pipe already exists
    /// or the session has no active connection.
    /// </returns>
    /// <remarks>
    /// On success, increments the session collector refcount. Idempotent open of the same
    /// <paramref name="pipeId"/> is rejected (not a second <c>AddRef</c>).
    /// </remarks>
    IResult<ISessionPipe> OpenPipe(Guid sessionId, Guid pipeId);

    /// <summary>
    /// Removes the pipe, marks it closed, and releases the session collector ref.
    /// </summary>
    /// <param name="pipeId">Pipe previously returned by <see cref="OpenPipe"/>.</param>
    /// <returns>
    /// Success when the pipe was open and closed; Failure when no pipe is registered for
    /// <paramref name="pipeId"/> (already closed or never opened).
    /// </returns>
    /// <remarks>
    /// Order: unregister → internal close (cancel lifetime) → collector <c>Release</c>.
    /// Holders of the old <see cref="ISessionPipe"/> reference see closed-pipe failures afterward.
    /// </remarks>
    IResult ClosePipe(Guid pipeId);

    /// <summary>
    /// Closes every open pipe for <paramref name="sessionId"/>.
    /// </summary>
    /// <param name="sessionId">Live session whose consumers should be disconnected.</param>
    /// <remarks>
    /// Best-effort and idempotent: used during session stop / start compensation.
    /// Each pipe is closed via <see cref="ClosePipe"/> (refcount drained toward zero).
    /// </remarks>
    void CloseAllSessionPipes(Guid sessionId);

    /// <summary>
    /// Attempts to resolve an open pipe by <paramref name="pipeId"/>.
    /// </summary>
    /// <param name="pipeId">Pipe id.</param>
    /// <param name="pipe">
    /// The pipe when the method returns <see langword="true"/>; otherwise <see langword="null"/>.
    /// </param>
    /// <returns>
    /// <see langword="true"/> when the pipe is registered; <see langword="false"/> when missing
    /// or already closed via <see cref="ClosePipe"/>.
    /// </returns>
    /// <remarks>
    /// Does not prove the pipe is still usable for I/O — after close races, prefer handling
    /// <c>IResult</c> Failure from pipe methods.
    /// </remarks>
    bool TryGetPipe(Guid pipeId, [NotNullWhen(true)] out ISessionPipe? pipe);
}
