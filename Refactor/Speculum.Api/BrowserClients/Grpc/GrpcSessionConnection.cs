using System.Threading.Channels;
using Aidan.Core.Patterns;
using Grpc.Core;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sidecar.V1;
using DomainDeviceProfile = Speculum.Api.Sessions.Models.DeviceProfile;
using DomainEditingState = Speculum.Api.Sessions.Models.EditingState;
using DomainResizeResult = Speculum.Api.Sessions.Models.ResizeResult;
using ProtoEmpty = Speculum.Api.Sidecar.V1.Empty;
using ProtoSessionId = Speculum.Api.Sidecar.V1.SessionId;

namespace Speculum.Api.BrowserClients.Grpc;

/// <summary>
/// gRPC-backed <see cref="ISessionConnection"/>. One WatchVideo / WatchConsole / Control /
/// PushInput writer per connection; status is polled GetStatus; informative signals on
/// <see cref="GetNotificationReader"/>; permission hooks reply on Control.
/// </summary>
public sealed class GrpcSessionConnection : ISessionConnection
{
    private readonly BrowserSessionService.BrowserSessionServiceClient _client;
    private readonly Action<Guid> _onClosed;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly object _gate = new();

    private readonly Channel<Frame> _frames = Channel.CreateBounded<Frame>(new BoundedChannelOptions(2)
    {
        FullMode = BoundedChannelFullMode.DropOldest,
        SingleReader = false,
        SingleWriter = false,
    });

    private readonly Channel<ConsoleOutput> _console = Channel.CreateBounded<ConsoleOutput>(
        new BoundedChannelOptions(256)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = false,
            SingleWriter = false,
        });

    private readonly Channel<SessionStatus> _status = Channel.CreateBounded<SessionStatus>(
        new BoundedChannelOptions(8)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = false,
            SingleWriter = false,
        });

    private readonly Channel<SessionNotification> _notifications =
        Channel.CreateBounded<SessionNotification>(new BoundedChannelOptions(32)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = false,
            SingleWriter = false,
        });

    private AsyncClientStreamingCall<InputEvent, ProtoEmpty>? _pushInput;
    private AsyncDuplexStreamingCall<ControlToSidecar, ControlFromSidecar>? _control;
    private DomainEditingState? _editing;
    private Func<CancellationToken, Task<PermissionDecision>>? _cameraPermissionHandler;
    private Func<CancellationToken, Task<PermissionDecision>>? _microphonePermissionHandler;
    private long _frameSequence;
    private int _open = 1;

    public GrpcSessionConnection(
        Guid sessionId,
        BrowserSessionService.BrowserSessionServiceClient client,
        Action<Guid> onClosed)
    {
        SessionId = sessionId;
        _client = client;
        _onClosed = onClosed;
    }

    public Guid SessionId { get; }

    public bool IsOpen => Volatile.Read(ref _open) == 1;

    public async Task StartStreamsAsync(CancellationToken ct)
    {
        EnsureOpen();
        var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, _lifetime.Token);
        var token = linked.Token;

        _pushInput = _client.PushInput(cancellationToken: token);
        _control = _client.Control(cancellationToken: token);

        _ = PumpVideoAsync(token);
        _ = PumpConsoleAsync(token);
        _ = PumpLocationAsync(token);
        _ = PumpNavigationBlockedAsync(token);
        _ = PumpEditableFocusAsync(token);
        _ = PumpCrashAsync(token);
        _ = PumpStatusAsync(token);
        _ = PumpControlAsync(token);
    }

    public async Task<IResult> CloseAsync(CancellationToken ct = default)
    {
        if (Interlocked.Exchange(ref _open, 0) == 0)
        {
            return Result.Success();
        }

        try
        {
            _lifetime.Cancel();
            if (_pushInput is not null)
            {
                try { await _pushInput.RequestStream.CompleteAsync(); } catch { /* */ }
                _pushInput.Dispose();
            }

            if (_control is not null)
            {
                try { await _control.RequestStream.CompleteAsync(); } catch { /* */ }
                _control.Dispose();
            }

            try
            {
                await _client.DisposeAsync(
                    new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                    cancellationToken: ct);
            }
            catch (RpcException)
            {
                /* best-effort */
            }
        }
        finally
        {
            _frames.Writer.TryComplete();
            _console.Writer.TryComplete();
            _status.Writer.TryComplete();
            _notifications.Writer.TryComplete();
            _onClosed(SessionId);
            _lifetime.Dispose();
        }

        return Result.Success();
    }

    public async Task<IResult<BrowserReadyInfo>> LaunchBrowserAsync(
        SessionConfig? configuration,
        CancellationToken ct = default)
    {
        var validated = GrpcRequestValidation.ValidateLaunch(configuration);
        if (validated.IsFailure)
        {
            return Result<BrowserReadyInfo>.Failure(validated.Errors.ToArray());
        }

        var (width, height) = validated.Value;
        return await CallValueAsync(async () =>
        {
            var ready = await WithLinkedAsync(ct, token =>
                _client.LaunchAsync(
                    GrpcSessionMappers.ToLaunchRequest(SessionId, width, height, configuration!),
                    cancellationToken: token).ResponseAsync);
            return Result<BrowserReadyInfo>.Success(GrpcSessionMappers.ToReadyInfo(ready));
        });
    }

    public async Task<IResult> StopBrowserAsync(CancellationToken ct = default)
    {
        return await CallAsync(async () =>
        {
            await WithLinkedAsync(ct, token =>
                _client.StopAsync(
                    new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                    cancellationToken: token).ResponseAsync);
            return Result.Success();
        });
    }

    public async Task<IResult<SessionState>> ExportSessionStateAsync(CancellationToken ct = default)
    {
        return await CallValueAsync(async () =>
        {
            var state = await WithLinkedAsync(ct, token =>
                _client.ExportStateAsync(
                    new ExportStateRequest { SessionId = SessionId.ToString("D") },
                    cancellationToken: token).ResponseAsync);
            return Result<SessionState>.Success(GrpcSessionMappers.ToSessionState(state));
        });
    }

    public async Task<IResult> RestoreProfileStateAsync(
        ProfileState state,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(state);
        return await CallAsync(async () =>
        {
            await WithLinkedAsync(ct, token =>
                _client.RestoreStateAsync(
                    GrpcSessionMappers.ToRestoreRequest(SessionId, state),
                    cancellationToken: token).ResponseAsync);
            return Result.Success();
        });
    }

    public async Task<IResult> NavigateAsync(string url, CancellationToken ct = default)
    {
        var validated = GrpcRequestValidation.ValidateNavigate(url);
        if (validated.IsFailure)
        {
            return Result.Failure(validated.Errors.ToArray());
        }

        return await CallAsync(async () =>
        {
            await WithLinkedAsync(ct, token =>
                _client.NavigateAsync(
                    new NavigateRequest { SessionId = SessionId.ToString("D"), Url = url },
                    cancellationToken: token).ResponseAsync);
            return Result.Success();
        });
    }

    public async Task<IResult> RefreshAsync(CancellationToken ct = default)
    {
        return await CallAsync(async () =>
        {
            await WithLinkedAsync(ct, token =>
                _client.RefreshAsync(
                    new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                    cancellationToken: token).ResponseAsync);
            return Result.Success();
        });
    }

    public async Task<IResult<DomainResizeResult>> ResizeAsync(
        string requestId,
        int width,
        int height,
        DomainDeviceProfile device,
        CancellationToken ct = default)
    {
        var validated = GrpcRequestValidation.ValidateResize(width, height);
        if (validated.IsFailure)
        {
            return Result<DomainResizeResult>.Failure(validated.Errors.ToArray());
        }

        return await CallValueAsync(async () =>
        {
            var request = new ResizeRequest
            {
                SessionId = SessionId.ToString("D"),
                Width = width,
                Height = height,
            };
            if (GrpcSessionMappers.TryToProtoDevice(device) is { } protoDevice)
            {
                request.Device = protoDevice;
            }

            var result = await WithLinkedAsync(ct, token =>
                _client.ResizeAsync(request, cancellationToken: token).ResponseAsync);
            return Result<DomainResizeResult>.Success(GrpcSessionMappers.ToResizeResult(requestId, result));
        });
    }

    public async Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
        DiagProbeRequest request,
        CancellationToken ct = default)
    {
        var validated = GrpcRequestValidation.ValidateProbe(request);
        if (validated.IsFailure)
        {
            return Result<DiagProbeResult>.Failure(validated.Errors.ToArray());
        }

        return await CallValueAsync(async () =>
        {
            var probe = new ProbeRequest { SessionId = SessionId.ToString("D") };
            probe.Ops.AddRange(request.Ops);
            if (!string.IsNullOrEmpty(request.EvaluateExpression))
            {
                probe.EvaluateExpression = request.EvaluateExpression;
            }

            if (!string.IsNullOrEmpty(request.DomSelector))
            {
                probe.DomSelector = request.DomSelector;
            }

            var result = await WithLinkedAsync(ct, token =>
                _client.ProbeAsync(probe, cancellationToken: token).ResponseAsync);
            return Result<DiagProbeResult>.Success(GrpcSessionMappers.ToProbeResult(result));
        });
    }

    public IResult<ChannelReader<Frame>> GetFrameReader()
    {
        if (!IsOpen) return Result<ChannelReader<Frame>>.Failure("Connection closed");
        return Result<ChannelReader<Frame>>.Success(_frames.Reader);
    }

    public IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputReader()
    {
        if (!IsOpen) return Result<ChannelReader<ConsoleOutput>>.Failure("Connection closed");
        return Result<ChannelReader<ConsoleOutput>>.Success(_console.Reader);
    }

    public IResult<ChannelReader<SessionStatus>> GetStatusReader()
    {
        if (!IsOpen) return Result<ChannelReader<SessionStatus>>.Failure("Connection closed");
        return Result<ChannelReader<SessionStatus>>.Success(_status.Reader);
    }

    public IResult<ChannelReader<SessionNotification>> GetNotificationReader()
    {
        if (!IsOpen) return Result<ChannelReader<SessionNotification>>.Failure("Connection closed");
        return Result<ChannelReader<SessionNotification>>.Success(_notifications.Reader);
    }

    public void SetCameraPermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler)
    {
        ArgumentNullException.ThrowIfNull(handler);
        _cameraPermissionHandler = handler;
    }

    public void SetMicrophonePermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler)
    {
        ArgumentNullException.ThrowIfNull(handler);
        _microphonePermissionHandler = handler;
    }

    public IResult<Task> ConsumeUserInputAsync(ChannelReader<string> channelReader)
    {
        if (!IsOpen || _pushInput is null)
        {
            return Result<Task>.Failure("Connection closed");
        }

        return Result<Task>.Success(PumpUserInputAsync(channelReader, _lifetime.Token));
    }

    public IResult<Task> ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader)
    {
        if (!IsOpen)
        {
            return Result<Task>.Failure("Connection closed");
        }

        return Result<Task>.Success(PumpConsoleInputAsync(channelReader, _lifetime.Token));
    }

    private async Task PumpUserInputAsync(ChannelReader<string> reader, CancellationToken ct)
    {
        var stream = _pushInput!.RequestStream;
        await foreach (var json in reader.ReadAllAsync(ct))
        {
            if (!GrpcSessionMappers.TryParseInputEvent(SessionId, json, out var input) || input is null)
            {
                throw new InvalidOperationException($"Invalid user input JSON: {json}");
            }

            await stream.WriteAsync(input, ct);
        }
    }

    private async Task PumpConsoleInputAsync(ChannelReader<ConsoleInput> reader, CancellationToken ct)
    {
        await foreach (var input in reader.ReadAllAsync(ct))
        {
            var codeValidation = GrpcRequestValidation.ValidateEvaluate(input.Code);
            if (codeValidation.IsFailure)
            {
                throw new InvalidOperationException(
                    string.Join("; ", codeValidation.Errors.Select(e => e.Message)));
            }

            try
            {
                var result = await _client.EvaluateAsync(
                    new EvaluateRequest
                    {
                        SessionId = SessionId.ToString("D"),
                        Code = input.Code,
                    },
                    cancellationToken: ct);
                await _console.Writer.WriteAsync(
                    GrpcSessionMappers.EvalResultToOutput(input.Id, result),
                    ct);
            }
            catch (RpcException ex) when (ex.StatusCode == StatusCode.Cancelled)
            {
                break;
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task PumpVideoAsync(CancellationToken ct)
    {
        try
        {
            using var call = _client.WatchVideo(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: ct);
            await foreach (var frame in call.ResponseStream.ReadAllAsync(ct))
            {
                var jpeg = frame.Jpeg.ToByteArray();
                var item = new Frame
                {
                    Jpeg = jpeg,
                    Sequence = Interlocked.Increment(ref _frameSequence),
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                };
                await _frames.Writer.WriteAsync(item, ct);
            }
        }
        catch (OperationCanceledException) { /* shutdown */ }
        catch (RpcException ex) when (ex.StatusCode is StatusCode.Cancelled or StatusCode.Unavailable)
        {
            /* shutdown */
        }
    }

    private async Task PumpConsoleAsync(CancellationToken ct)
    {
        try
        {
            using var call = _client.WatchConsole(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: ct);
            await foreach (var ev in call.ResponseStream.ReadAllAsync(ct))
            {
                await _console.Writer.WriteAsync(GrpcSessionMappers.ConsoleEventToOutput(ev), ct);
            }
        }
        catch (OperationCanceledException) { /* */ }
        catch (RpcException) { /* */ }
    }

    private async Task PumpLocationAsync(CancellationToken ct)
    {
        try
        {
            using var call = _client.WatchLocation(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: ct);
            await foreach (var ev in call.ResponseStream.ReadAllAsync(ct))
            {
                await _notifications.Writer.WriteAsync(
                    new SessionNotification
                    {
                        Kind = SessionNotificationKind.LocationChanged,
                        Url = ev.Url,
                    },
                    ct);
            }
        }
        catch (OperationCanceledException) { /* */ }
        catch (RpcException) { /* */ }
    }

    private async Task PumpNavigationBlockedAsync(CancellationToken ct)
    {
        try
        {
            using var call = _client.WatchNavigationBlocked(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: ct);
            await foreach (var ev in call.ResponseStream.ReadAllAsync(ct))
            {
                await _notifications.Writer.WriteAsync(
                    new SessionNotification
                    {
                        Kind = SessionNotificationKind.MainFrameNavigationBlocked,
                        Url = ev.Url,
                    },
                    ct);
            }
        }
        catch (OperationCanceledException) { /* */ }
        catch (RpcException) { /* */ }
    }

    private async Task PumpEditableFocusAsync(CancellationToken ct)
    {
        try
        {
            using var call = _client.WatchEditableFocus(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: ct);
            await foreach (var ev in call.ResponseStream.ReadAllAsync(ct))
            {
                DomainEditingState? editing = null;
                if (ev.Focused && ev.Editing is { } e)
                {
                    editing = new DomainEditingState
                    {
                        Focused = true,
                        InputMode = e.HasInputMode ? e.InputMode : null,
                        Multiline = e.Multiline,
                        TagName = e.HasTagName ? e.TagName : null,
                    };
                }

                lock (_gate)
                {
                    _editing = editing;
                }

                await _notifications.Writer.WriteAsync(
                    new SessionNotification
                    {
                        Kind = SessionNotificationKind.EditableFocusChanged,
                        Editing = editing,
                    },
                    ct);
            }
        }
        catch (OperationCanceledException) { /* */ }
        catch (RpcException) { /* */ }
    }

    private async Task PumpCrashAsync(CancellationToken ct)
    {
        try
        {
            using var call = _client.WatchCrash(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: ct);
            await foreach (var crash in call.ResponseStream.ReadAllAsync(ct))
            {
                await _notifications.Writer.WriteAsync(
                    new SessionNotification
                    {
                        Kind = SessionNotificationKind.Crashed,
                        ErrorCode = crash.ErrorCode,
                        Message = crash.Message,
                        Phase = crash.HasPhase ? crash.Phase : null,
                    },
                    ct);
                await CloseAsync(CancellationToken.None);
                break;
            }
        }
        catch (OperationCanceledException) { /* */ }
        catch (RpcException) { /* */ }
    }

    private async Task PumpStatusAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested && IsOpen)
            {
                await PublishStatusAsync(ct);
                await Task.Delay(1000, ct);
            }
        }
        catch (OperationCanceledException) { /* */ }
    }

    private async Task PublishStatusAsync(CancellationToken ct)
    {
        try
        {
            var status = await _client.GetStatusAsync(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: ct);
            DomainEditingState? editing;
            lock (_gate)
            {
                editing = _editing;
            }

            await _status.Writer.WriteAsync(
                GrpcSessionMappers.ToSessionStatus(SessionId, status, editing),
                ct);
        }
        catch (RpcException)
        {
            /* transient */
        }
    }

    private async Task PumpControlAsync(CancellationToken ct)
    {
        var call = _control;
        if (call is null) return;
        try
        {
            await foreach (var msg in call.ResponseStream.ReadAllAsync(ct))
            {
                if (msg.PermissionRequest is not { } req) continue;

                var allow = false;
                try
                {
                    var handler = req.Kind switch
                    {
                        PermissionKind.Camera => _cameraPermissionHandler,
                        PermissionKind.Microphone => _microphonePermissionHandler,
                        _ => null,
                    };
                    if (handler is not null)
                    {
                        var decision = await handler(ct);
                        allow = decision == PermissionDecision.Allow;
                    }
                }
                catch
                {
                    allow = false;
                }

                await call.RequestStream.WriteAsync(
                    new ControlToSidecar
                    {
                        PermissionReply = new PermissionReply
                        {
                            CorrId = req.CorrId,
                            Allow = allow,
                            SessionId = req.SessionId,
                        },
                    },
                    ct);
            }
        }
        catch (OperationCanceledException) { /* */ }
        catch (RpcException) { /* */ }
    }

    private async Task<T> WithLinkedAsync<T>(CancellationToken ct, Func<CancellationToken, Task<T>> action)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, _lifetime.Token);
        return await action(linked.Token);
    }

    private async Task WithLinkedAsync(CancellationToken ct, Func<CancellationToken, Task> action)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, _lifetime.Token);
        await action(linked.Token);
    }

    private void EnsureOpen()
    {
        if (!IsOpen)
        {
            throw new InvalidOperationException("Connection closed");
        }
    }

    private async Task<IResult> CallAsync(Func<Task<IResult>> action)
    {
        if (!IsOpen) return Result.Failure("Connection closed");
        try
        {
            return await action();
        }
        catch (RpcException ex)
        {
            return Result.Failure(ex.Status.Detail ?? ex.Message);
        }
    }

    private async Task<IResult<T>> CallValueAsync<T>(Func<Task<Result<T>>> action)
    {
        if (!IsOpen) return Result<T>.Failure("Connection closed");
        try
        {
            return await action();
        }
        catch (RpcException ex)
        {
            return Result<T>.Failure(ex.Status.Detail ?? ex.Message);
        }
    }
}
