using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Shared.Services;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// In-memory context for one live connection: mux, hooks, commands, attachments.
/// Output streams are owned by callers (dispose to unregister); presence is Attach/Detach.
/// </summary>
internal sealed class LiveSession : ILiveSession
{
    private readonly ISessionConnection _connection;
    private readonly ISessionStreamMultiplexer _mux;
    private readonly SessionHooks _hooks;
    private readonly ISessionCollector _collector;
    private readonly IUrlResolver _urls;
    private readonly ScopedMutex _commandGate = new();
    private readonly object _attachmentGate = new();
    private readonly HashSet<Guid> _attachments = new();
    private readonly Guid _inputConsumerId = Guid.CreateVersion7();

    private CancellationTokenSource? _lifetime = new();
    private int _released;

    public Guid SessionId { get; }

    internal LiveSession(
        Guid sessionId,
        ISessionConnection connection,
        ISessionStreamMultiplexer mux,
        SessionHooks hooks,
        ISessionCollector collector,
        IUrlResolver urls)
    {
        SessionId = sessionId;
        _connection = connection;
        _mux = mux;
        _hooks = hooks;
        _collector = collector;
        _urls = urls;

        hooks.BindToConnection(connection);

        var inputRegister = mux.RegisterInputConsumer(_inputConsumerId);
        if (inputRegister.IsFailure)
        {
            throw new InvalidOperationException("Failed to register live-session input consumer");
        }
    }

    internal void Release()
    {
        if (Interlocked.Exchange(ref _released, 1) != 0)
        {
            return;
        }

        lock (_attachmentGate)
        {
            foreach (var _ in _attachments)
            {
                _collector.Release(SessionId);
            }

            _attachments.Clear();
        }

        _hooks.Unbind(_connection.IsOpen ? _connection : null);
        _mux.Dispose();

        var lifetime = Interlocked.Exchange(ref _lifetime, null);
        if (lifetime is null)
        {
            return;
        }

        try
        {
            lifetime.Cancel();
        }
        finally
        {
            lifetime.Dispose();
        }
    }

    private bool IsReleased => Volatile.Read(ref _released) != 0;

    // ── Caller attachment ────────────────────────────────────────────────────

    public IResult<Guid> Attach()
    {
        lock (_attachmentGate)
        {
            if (IsReleased)
            {
                return Result<Guid>.Failure("Live session is released");
            }

            var attachmentId = Guid.CreateVersion7();
            _attachments.Add(attachmentId);
            _collector.AddRef(SessionId);
            return Result<Guid>.Success(attachmentId);
        }
    }

    public IResult Detach(Guid attachmentId)
    {
        lock (_attachmentGate)
        {
            if (IsReleased)
            {
                // Release already dropped all attachments and collector refs.
                return Result.Success();
            }

            if (!_attachments.Remove(attachmentId))
            {
                return Result.Failure("Attachment not found");
            }

            _collector.Release(SessionId);
            return Result.Success();
        }
    }

    // ── Streams ──────────────────────────────────────────────────────────────

    public IResult<IFrameStream> OpenFrameStream()
        => OpenStream(static (id, mux) => (IFrameStream)new FrameStream(id, mux));

    public IResult<IConsoleOutputStream> OpenConsoleOutputStream()
        => OpenStream(static (id, mux) => (IConsoleOutputStream)new ConsoleOutputStream(id, mux));

    public IResult<INotificationStream> OpenNotificationStream()
        => OpenStream(static (id, mux) => (INotificationStream)new NotificationStream(id, mux));

    public IResult<Task> ConsumeUserInputAsync(
        ChannelReader<string> channelReader,
        CancellationToken ct = default)
        => StartInputPump(
            (consumerId, token) => _mux.StartUserInputPump(consumerId, channelReader, token),
            ct);

    public IResult<Task> ConsumeConsoleInputAsync(
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct = default)
        => StartInputPump(
            (consumerId, token) => _mux.StartConsoleInputPump(consumerId, channelReader, token),
            ct);

    // ── Commands ─────────────────────────────────────────────────────────────

    public async Task<IResult<SessionStatus>> GetStatusAsync(CancellationToken ct = default)
    {
        if (IsReleased || !_connection.IsOpen)
        {
            return Result<SessionStatus>.Failure("Live session is released");
        }

        return await _connection.GetStatusAsync(ct).ConfigureAwait(false);
    }

    public Task<IResult> NavigateAsync(NavigateSession request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return WithCommandGateAsync(
            async () =>
            {
                var urlResult = _urls.Resolve(request.Path, request.Query);
                if (urlResult.IsFailure)
                {
                    return Result.Failure(urlResult.Errors.ToArray());
                }

                return await _connection.NavigateAsync(urlResult.Value, ct).ConfigureAwait(false);
            },
            ct);
    }

    public Task<IResult> RefreshAsync(CancellationToken ct = default)
        => WithCommandGateAsync(() => _connection.RefreshAsync(ct), ct);

    public Task<IResult<ResizeResult>> ResizeAsync(ResizeSession request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return WithCommandGateAsync(
            () =>
            {
                var requestId = string.IsNullOrWhiteSpace(request.RequestId)
                    ? Guid.CreateVersion7().ToString("D")
                    : request.RequestId.Trim();

                var device = request.Device ?? new DeviceProfile();
                return _connection.ResizeAsync(
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
            () => _connection.RequestDiagnosticsAsync(request.Probe, ct),
            ct);
    }

    // ── Hooks ────────────────────────────────────────────────────────────────

    public IResult<Guid> RegisterCameraPermission(
        Func<CancellationToken, Task<PermissionDecision>> handler)
        => IsReleased
            ? Result<Guid>.Failure("Live session is released")
            : _hooks.RegisterCameraPermission(handler);

    public IResult UnregisterCameraPermission(Guid registrationId)
        => IsReleased
            ? Result.Failure("Live session is released")
            : _hooks.UnregisterCameraPermission(registrationId);

    public IResult<Guid> RegisterMicrophonePermission(
        Func<CancellationToken, Task<PermissionDecision>> handler)
        => IsReleased
            ? Result<Guid>.Failure("Live session is released")
            : _hooks.RegisterMicrophonePermission(handler);

    public IResult UnregisterMicrophonePermission(Guid registrationId)
        => IsReleased
            ? Result.Failure("Live session is released")
            : _hooks.UnregisterMicrophonePermission(registrationId);

    private IResult<TStream> OpenStream<TStream>(
        Func<Guid, ISessionStreamMultiplexer, TStream> create)
    {
        if (IsReleased)
        {
            return Result<TStream>.Failure("Live session is released");
        }

        var id = Guid.CreateVersion7();
        var register = _mux.RegisterPipe(id);
        if (register.IsFailure)
        {
            return Result<TStream>.Failure(register.Errors.ToArray());
        }

        return Result<TStream>.Success(create(id, _mux));
    }

    private IResult<Task> StartInputPump(
        Func<Guid, CancellationToken, IResult<Task>> start,
        CancellationToken ct)
    {
        if (IsReleased)
        {
            return Result<Task>.Failure("Live session is released");
        }

        if (!TryGetLifetimeToken(out var lifetimeToken))
        {
            return Result<Task>.Failure("Live session is released");
        }

        var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, lifetimeToken);
        var pump = start(_inputConsumerId, linked.Token);
        if (pump.IsFailure)
        {
            linked.Dispose();
            return pump;
        }

        return Result<Task>.Success(ObserveAndDisposeAsync(pump.Value, linked));
    }

    private bool TryGetLifetimeToken(out CancellationToken token)
    {
        token = default;
        var lifetime = Volatile.Read(ref _lifetime);
        if (lifetime is null)
        {
            return false;
        }

        try
        {
            token = lifetime.Token;
            return true;
        }
        catch (ObjectDisposedException)
        {
            return false;
        }
    }

    private async Task<IResult> WithCommandGateAsync(
        Func<Task<IResult>> action,
        CancellationToken ct)
    {
        if (IsReleased || !_connection.IsOpen)
        {
            return Result.Failure("Live session is released");
        }

        await using (await _commandGate.AcquireAsync(SessionId, ct).ConfigureAwait(false))
        {
            if (IsReleased || !_connection.IsOpen)
            {
                return Result.Failure("Live session is released");
            }

            return await action().ConfigureAwait(false);
        }
    }

    private async Task<IResult<T>> WithCommandGateAsync<T>(
        Func<Task<IResult<T>>> action,
        CancellationToken ct)
    {
        if (IsReleased || !_connection.IsOpen)
        {
            return Result<T>.Failure("Live session is released");
        }

        await using (await _commandGate.AcquireAsync(SessionId, ct).ConfigureAwait(false))
        {
            if (IsReleased || !_connection.IsOpen)
            {
                return Result<T>.Failure("Live session is released");
            }

            return await action().ConfigureAwait(false);
        }
    }

    private static async Task ObserveAndDisposeAsync(Task pump, CancellationTokenSource linked)
    {
        try
        {
            await pump.ConfigureAwait(false);
        }
        finally
        {
            linked.Dispose();
        }
    }
}
