using System.Diagnostics.CodeAnalysis;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;

namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Registry for in-memory <see cref="ILiveSession"/> contexts (one per live connection).
/// </summary>
public interface ILiveSessionService
{
    /// <summary>
    /// Creates and binds the runtime context (mux, hooks) to an open connection.
    /// Fails when a context already exists or the connection is not usable.
    /// Does not own browser/connection lifecycle — that is <see cref="ISessionService"/>.
    /// </summary>
    IResult<ILiveSession> Create(Guid sessionId, ISessionConnection connection);

    /// <summary>Looks up an existing context. Never creates one.</summary>
    bool TryGet(Guid sessionId, [NotNullWhen(true)] out ILiveSession? session);

    /// <summary>
    /// Tears down the context: unbinds hooks, disposes the multiplexer, drops attachments.
    /// Idempotent. Does not stop the browser / connection (that is <see cref="ISessionService"/>).
    /// </summary>
    void Release(Guid sessionId);
}
