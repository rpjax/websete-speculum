using Aidan.Core.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.BrowserClients;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Shared.Services;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// Application orchestrator for unary live-session commands.
/// </summary>
/// <remarks>
/// Mutating commands serialize per session on a private async gate (does not share the
/// pipe lifecycle mutex). <see cref="GetStatusAsync"/> does not hold that gate across
/// the sidecar RTT — resolve then poll.
/// </remarks>
public sealed class SessionCommandService : ISessionCommandService
{
    private readonly IBrowserClient _browserClient;
    private readonly IUrlResolver _urls;
    private readonly IServiceScopeFactory _scopeFactory;

    /// <summary>
    /// Per-session gate for mutating commands only. Owned here so status polls and pipe
    /// open/close are never stalled by navigate/resize RTT on the shared pipe mutex.
    /// </summary>
    private readonly ScopedMutex _commandGate = new();

    public SessionCommandService(
        IBrowserClient browserClient,
        IUrlResolver urls,
        IServiceScopeFactory scopeFactory)
    {
        _browserClient = browserClient;
        _urls = urls;
        _scopeFactory = scopeFactory;
    }

    public async Task<IResult<SessionStatus>> GetStatusAsync(
        Guid sessionId,
        CancellationToken ct = default)
    {
        var resolved = await ResolveLiveConnectionAsync(sessionId, ct).ConfigureAwait(false);
        if (resolved.IsFailure)
        {
            return Result<SessionStatus>.Failure(resolved.Errors.ToArray());
        }

        return await resolved.Value.GetStatusAsync(ct).ConfigureAwait(false);
    }

    public Task<IResult> NavigateAsync(
        NavigateSession request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        return WithCommandGateAsync(
            request.SessionId,
            async connection =>
            {
                var urlResult = _urls.Resolve(request.Path, request.Query);
                if (urlResult.IsFailure)
                {
                    return Result.Failure(urlResult.Errors.ToArray());
                }

                return await connection.NavigateAsync(urlResult.Value, ct).ConfigureAwait(false);
            },
            ct);
    }

    public Task<IResult> RefreshAsync(
        Guid sessionId,
        CancellationToken ct = default)
        => WithCommandGateAsync(
            sessionId,
            connection => connection.RefreshAsync(ct),
            ct);

    public Task<IResult<ResizeResult>> ResizeAsync(
        ResizeSession request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        return WithCommandGateAsync(
            request.SessionId,
            connection =>
            {
                var requestId = string.IsNullOrWhiteSpace(request.RequestId)
                    ? Guid.CreateVersion7().ToString("D")
                    : request.RequestId.Trim();

                var device = request.Device ?? new DeviceProfile();
                return connection.ResizeAsync(
                    requestId,
                    request.Width,
                    request.Height,
                    device,
                    ct);
            },
            ct);
    }

    public Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
        ProbeSession request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(request.Probe);

        return WithCommandGateAsync(
            request.SessionId,
            connection => connection.RequestDiagnosticsAsync(request.Probe, ct),
            ct);
    }

    private async Task<IResult> WithCommandGateAsync(
        Guid sessionId,
        Func<ISessionConnection, Task<IResult>> action,
        CancellationToken ct)
    {
        await using (await _commandGate.AcquireAsync(sessionId, ct).ConfigureAwait(false))
        {
            var resolved = await ResolveLiveConnectionAsync(sessionId, ct).ConfigureAwait(false);
            if (resolved.IsFailure)
            {
                return Result.Failure(resolved.Errors.ToArray());
            }

            return await action(resolved.Value).ConfigureAwait(false);
        }
    }

    private async Task<IResult<T>> WithCommandGateAsync<T>(
        Guid sessionId,
        Func<ISessionConnection, Task<IResult<T>>> action,
        CancellationToken ct)
    {
        await using (await _commandGate.AcquireAsync(sessionId, ct).ConfigureAwait(false))
        {
            var resolved = await ResolveLiveConnectionAsync(sessionId, ct).ConfigureAwait(false);
            if (resolved.IsFailure)
            {
                return Result<T>.Failure(resolved.Errors.ToArray());
            }

            return await action(resolved.Value).ConfigureAwait(false);
        }
    }

    private async Task<IResult<ISessionConnection>> ResolveLiveConnectionAsync(
        Guid sessionId,
        CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var repository = scope.ServiceProvider.GetRequiredService<ISessionRepository>();
        var session = await repository.LoadAsync(sessionId, ct).ConfigureAwait(false);

        if (session is null)
        {
            return Result<ISessionConnection>.Failure("Session not found");
        }

        if (session.State != LifecycleState.Live)
        {
            return Result<ISessionConnection>.Failure("Session is not live");
        }

        if (!_browserClient.TryGetConnection(sessionId, out var connection) || !connection.IsOpen)
        {
            return Result<ISessionConnection>.Failure("The session does not have an active connection");
        }

        return Result<ISessionConnection>.Success(connection);
    }
}
