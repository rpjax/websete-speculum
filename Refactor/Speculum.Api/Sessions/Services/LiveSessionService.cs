using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Aidan.Core.Patterns;
using Microsoft.Extensions.Options;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Pipes.Streaming;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Shared.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// Tracks one <see cref="LiveSession"/> context per live connection.
/// </summary>
public sealed class LiveSessionService : ILiveSessionService
{
    private readonly ConcurrentDictionary<Guid, LiveSession> _sessions = new();
    private readonly ISessionCollector _collector;
    private readonly IUrlResolver _urls;
    private readonly IOptions<SessionsConfiguration> _sessionsOptions;
    private readonly IScopedMutex _mutex;

    public LiveSessionService(
        ISessionCollector collector,
        IUrlResolver urls,
        IOptions<SessionsConfiguration> sessionsOptions,
        IScopedMutex mutex)
    {
        _collector = collector;
        _urls = urls;
        _sessionsOptions = sessionsOptions;
        _mutex = mutex;
    }

    public IResult<ILiveSession> Create(Guid sessionId, ISessionConnection connection)
    {
        ArgumentNullException.ThrowIfNull(connection);

        if (connection.SessionId != sessionId)
        {
            return Result<ILiveSession>.Failure("Connection does not belong to this session");
        }

        if (!connection.IsOpen)
        {
            return Result<ILiveSession>.Failure("The session does not have an active connection");
        }

        using (_mutex.Acquire(sessionId))
        {
            if (_sessions.ContainsKey(sessionId))
            {
                return Result<ILiveSession>.Failure("Live session already exists");
            }

            var options = _sessionsOptions.Value;
            var mux = new SessionStreamMultiplexer(
                connection,
                options.InputMultiplexingPolicy.Access,
                options.IsJsBridgeEnabled);
            var hooks = new SessionHooks(sessionId);
            var live = new LiveSession(
                sessionId,
                connection,
                mux,
                hooks,
                _collector,
                _urls);

            if (!_sessions.TryAdd(sessionId, live))
            {
                live.Release();
                return Result<ILiveSession>.Failure("Live session already exists");
            }

            return Result<ILiveSession>.Success(live);
        }
    }

    public bool TryGet(Guid sessionId, [NotNullWhen(true)] out ILiveSession? session)
    {
        if (_sessions.TryGetValue(sessionId, out var concrete))
        {
            session = concrete;
            return true;
        }

        session = null;
        return false;
    }

    public void Release(Guid sessionId)
    {
        using (_mutex.Acquire(sessionId))
        {
            if (!_sessions.TryRemove(sessionId, out var live))
            {
                return;
            }

            live.Release();
        }
    }
}
