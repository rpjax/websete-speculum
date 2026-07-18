using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.BrowserSessions.Services.Contracts;
using Speculum.Api.Shared.Services.Contracts;

namespace Speculum.Api.BrowserSessions.Services;

public class SessionPipeService : ISessionPipeService
{
    private readonly ConcurrentDictionary<Guid, SessionPipe> _pipes = new();
    private readonly IBrowserClient _browserClient;
    private readonly ISessionCollector _collector;
    private readonly IScopedMutex _mutex;

    public SessionPipeService(
        IBrowserClient browserClient,
        ISessionCollector collector,
        IScopedMutex mutex)
    {
        _browserClient = browserClient;
        _collector = collector;
        _mutex = mutex;
    }

    public IResult<ISessionPipe> OpenPipe(Guid sessionId, Guid pipeId)
    {
        using (_mutex.Acquire(pipeId))
        {
            if (_pipes.ContainsKey(pipeId))
            {
                return Result<ISessionPipe>.Failure("Pipe already exists");
            }

            if (!_browserClient.TryGetConnection(sessionId, out var connection))
            {
                return Result<ISessionPipe>.Failure("The session does not have an active connection");
            }

            var pipe = new SessionPipe(pipeId, sessionId, connection);

            if (!_pipes.TryAdd(pipeId, pipe))
            {
                return Result<ISessionPipe>.Failure("Pipe already exists");
            }

            _collector.AddRef(sessionId);
            return Result<ISessionPipe>.Success(pipe);
        }
    }

    public IResult ClosePipe(Guid pipeId)
    {
        using (_mutex.Acquire(pipeId))
        {
            if (!_pipes.TryRemove(pipeId, out var pipe))
            {
                return Result.Failure("Pipe not found");
            }

            pipe.Close();
            _collector.Release(pipe.SessionId);
            return Result.Success();
        }
    }

    public void CloseAllSessionPipes(Guid sessionId)
    {
        foreach (var pipeId in _pipes
                     .Where(static kv => kv.Value.SessionId == sessionId)
                     .Select(static kv => kv.Key)
                     .ToArray())
        {
            ClosePipe(pipeId);
        }
    }

    public bool TryGetPipe(Guid pipeId, [NotNullWhen(true)] out ISessionPipe? pipe)
    {
        if (_pipes.TryGetValue(pipeId, out var concrete))
        {
            pipe = concrete;
            return true;
        }

        pipe = null;
        return false;
    }
}
