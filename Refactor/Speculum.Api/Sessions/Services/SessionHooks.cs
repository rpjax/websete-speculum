using System.Collections.Concurrent;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// Per-connection hooks: owns connection <c>Set*PermissionHandler</c> callbacks and
/// multiplexes to application-layer registrations.
/// </summary>
internal sealed class SessionHooks : ISessionHooks
{
    private readonly ConcurrentDictionary<Guid, Func<CancellationToken, Task<PermissionDecision>>> _camera = new();
    private readonly ConcurrentDictionary<Guid, Func<CancellationToken, Task<PermissionDecision>>> _microphone = new();
    private int _closed;

    public Guid SessionId { get; }

    internal SessionHooks(Guid sessionId)
    {
        SessionId = sessionId;
    }

    /// <summary>
    /// Installs this instance's private multiplexors on the connection. Call once on attach.
    /// </summary>
    internal void BindToConnection(ISessionConnection connection)
    {
        connection.SetCameraPermissionHandler(OnCameraPermissionAsync);
        connection.SetMicrophonePermissionHandler(OnMicrophonePermissionAsync);
    }

    /// <summary>
    /// Clears registrants and points the connection at deny (if still open).
    /// </summary>
    internal void Unbind(ISessionConnection? connection)
    {
        if (Interlocked.Exchange(ref _closed, 1) != 0)
        {
            return;
        }

        _camera.Clear();
        _microphone.Clear();

        if (connection is { IsOpen: true })
        {
            connection.SetCameraPermissionHandler(static _ => Task.FromResult(PermissionDecision.Deny));
            connection.SetMicrophonePermissionHandler(static _ => Task.FromResult(PermissionDecision.Deny));
        }
    }

    public IResult<Guid> RegisterCameraPermission(
        Func<CancellationToken, Task<PermissionDecision>> handler)
    {
        ArgumentNullException.ThrowIfNull(handler);
        if (IsClosed)
        {
            return Result<Guid>.Failure("Hooks are detached");
        }

        var id = Guid.CreateVersion7();
        if (!_camera.TryAdd(id, handler))
        {
            return Result<Guid>.Failure("Registration failed");
        }

        return Result<Guid>.Success(id);
    }

    public IResult UnregisterCameraPermission(Guid registrationId)
    {
        if (!_camera.TryRemove(registrationId, out _))
        {
            return Result.Failure("Camera registration not found");
        }

        return Result.Success();
    }

    public IResult<Guid> RegisterMicrophonePermission(
        Func<CancellationToken, Task<PermissionDecision>> handler)
    {
        ArgumentNullException.ThrowIfNull(handler);
        if (IsClosed)
        {
            return Result<Guid>.Failure("Hooks are detached");
        }

        var id = Guid.CreateVersion7();
        if (!_microphone.TryAdd(id, handler))
        {
            return Result<Guid>.Failure("Registration failed");
        }

        return Result<Guid>.Success(id);
    }

    public IResult UnregisterMicrophonePermission(Guid registrationId)
    {
        if (!_microphone.TryRemove(registrationId, out _))
        {
            return Result.Failure("Microphone registration not found");
        }

        return Result.Success();
    }

    private bool IsClosed => Volatile.Read(ref _closed) != 0;

    private Task<PermissionDecision> OnCameraPermissionAsync(CancellationToken ct)
        => MultiplexAsync(_camera, ct);

    private Task<PermissionDecision> OnMicrophonePermissionAsync(CancellationToken ct)
        => MultiplexAsync(_microphone, ct);

    /// <summary>
    /// Fail-closed multiplex: empty → Deny; any Deny/fault → Deny; else Allow.
    /// Snapshot registrants under a short lock so a concurrent unregister cannot
    /// mutate the enumeration mid-flight.
    /// </summary>
    private static async Task<PermissionDecision> MultiplexAsync(
        ConcurrentDictionary<Guid, Func<CancellationToken, Task<PermissionDecision>>> registrants,
        CancellationToken ct)
    {
        var handlers = registrants.Values.ToArray();
        if (handlers.Length == 0)
        {
            return PermissionDecision.Deny;
        }

        foreach (var handler in handlers)
        {
            PermissionDecision decision;
            try
            {
                decision = await handler(ct).ConfigureAwait(false);
            }
            catch
            {
                return PermissionDecision.Deny;
            }

            if (decision != PermissionDecision.Allow)
            {
                return PermissionDecision.Deny;
            }
        }

        return PermissionDecision.Allow;
    }
}
