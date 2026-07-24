using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Aidan.Core.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Pipes.Services.Contracts;
using Speculum.Api.Sessions.Pipes.Streaming;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Shared.Services.Contracts;

namespace Speculum.Api.Sessions.Pipes.Services;

public class SessionPipeService : ISessionPipeService
{
    private readonly ConcurrentDictionary<Guid, SessionPipe> _pipes = new();
    private readonly ConcurrentDictionary<Guid, ISessionStreamMultiplexer> _multiplexers = new();
    private readonly IBrowserClient _browserClient;
    private readonly ISessionCollector _collector;
    private readonly IScopedMutex _mutex;
    private readonly IAsyncScopedMutex _asyncMutex;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IOptions<SessionsConfiguration> _sessionsOptions;

    public SessionPipeService(
        IBrowserClient browserClient,
        ISessionCollector collector,
        IScopedMutex mutex,
        IAsyncScopedMutex asyncMutex,
        IServiceScopeFactory scopeFactory,
        IOptions<SessionsConfiguration> sessionsOptions)
    {
        _browserClient = browserClient;
        _collector = collector;
        _mutex = mutex;
        _asyncMutex = asyncMutex;
        _scopeFactory = scopeFactory;
        _sessionsOptions = sessionsOptions;
    }

    public async Task<IResult<ISessionPipe>> OpenPipeAsync(
        Guid sessionId,
        CancellationToken ct = default)
    {
        await using (await _asyncMutex.AcquireAsync(sessionId, ct).ConfigureAwait(false))
        {
            using var scope = _scopeFactory.CreateScope();
            var repository = scope.ServiceProvider.GetRequiredService<ISessionRepository>();
            var session = await repository.LoadAsync(sessionId, ct).ConfigureAwait(false);

            if (session is null)
            {
                return Result<ISessionPipe>.Failure("Session not found");
            }

            if (session.State != LifecycleState.Live)
            {
                return Result<ISessionPipe>.Failure("Session is not live");
            }

            if (!_browserClient.TryGetConnection(sessionId, out var connection) || !connection.IsOpen)
            {
                return Result<ISessionPipe>.Failure("The session does not have an active connection");
            }

            var multiplexer = GetOrCreateMultiplexer(sessionId, connection);

            var pipeId = Guid.CreateVersion7();
            var register = multiplexer.RegisterPipe(pipeId);
            if (register.IsFailure)
            {
                RemoveMultiplexerIfEmpty(sessionId, multiplexer);
                return Result<ISessionPipe>.Failure(register.Errors.ToArray());
            }

            var pipe = new SessionPipe(pipeId, sessionId, multiplexer);

            if (!_pipes.TryAdd(pipeId, pipe))
            {
                multiplexer.UnregisterPipe(pipeId);
                RemoveMultiplexerIfEmpty(sessionId, multiplexer);
                return Result<ISessionPipe>.Failure("Pipe already exists");
            }

            _collector.AddRef(sessionId);
            return Result<ISessionPipe>.Success(pipe);
        }
    }

    public IResult ClosePipe(Guid pipeId)
    {
        if (!_pipes.TryGetValue(pipeId, out var peek))
        {
            return Result.Failure("Pipe not found");
        }

        var sessionId = peek.SessionId;
        using (_mutex.Acquire(sessionId))
        {
            if (!_pipes.TryRemove(pipeId, out var pipe))
            {
                return Result.Failure("Pipe not found");
            }

            pipe.Close();
            _collector.Release(sessionId);

            if (_multiplexers.TryGetValue(sessionId, out var multiplexer))
            {
                RemoveMultiplexerIfEmpty(sessionId, multiplexer);
            }

            return Result.Success();
        }
    }

    public void CloseAllSessionPipes(Guid sessionId)
    {
        using (_mutex.Acquire(sessionId))
        {
            foreach (var pipeId in _pipes
                         .Where(kv => kv.Value.SessionId == sessionId)
                         .Select(static kv => kv.Key)
                         .ToArray())
            {
                if (!_pipes.TryRemove(pipeId, out var pipe))
                {
                    continue;
                }

                pipe.Close();
                _collector.Release(sessionId);
            }

            if (_multiplexers.TryGetValue(sessionId, out var multiplexer))
            {
                RemoveMultiplexerIfEmpty(sessionId, multiplexer);
            }
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

    private ISessionStreamMultiplexer GetOrCreateMultiplexer(
        Guid sessionId,
        ISessionConnection connection)
    {
        if (_multiplexers.TryGetValue(sessionId, out var existing))
        {
            if (existing.IsAlive && existing.IsBoundTo(connection))
            {
                return existing;
            }

            _multiplexers.TryRemove(
                new KeyValuePair<Guid, ISessionStreamMultiplexer>(sessionId, existing));
        }

        var options = _sessionsOptions.Value;
        var created = new SessionStreamMultiplexer(
            connection,
            options.InputMultiplexingPolicy.Access,
            options.IsJsBridgeEnabled);

        if (!_multiplexers.TryAdd(sessionId, created))
        {
            // Session mutex should make this unreachable; prefer the map entry if it races.
            return _multiplexers.TryGetValue(sessionId, out var raced) ? raced : created;
        }

        return created;
    }

    private void RemoveMultiplexerIfEmpty(Guid sessionId, ISessionStreamMultiplexer multiplexer)
    {
        if (!multiplexer.IsEmpty && multiplexer.IsAlive)
        {
            return;
        }

        _multiplexers.TryRemove(
            new KeyValuePair<Guid, ISessionStreamMultiplexer>(sessionId, multiplexer));
    }
}
