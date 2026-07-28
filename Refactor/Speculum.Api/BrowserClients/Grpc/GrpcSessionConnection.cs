using System.Text.Json;
using System.Threading.Channels;
using Aidan.Core.Patterns;
using Grpc.Core;
using Microsoft.Extensions.Logging;
using Speculum.Api.Configurations.Models.Sidecar;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Journal.Services.Contracts;
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
/// PushInput writer per connection; status is on-demand GetStatus; informative signals on
/// <see cref="GetNotificationReader"/>; permission hooks reply on Control.
/// Transient transport blips retry internally; <c>Crashed</c> is only from WatchCrash.
/// </summary>
public sealed class GrpcSessionConnection : ISessionConnection
{
    private readonly BrowserSessionService.BrowserSessionServiceClient _client;
    private readonly IConfigurationService _configuration;
    private readonly IJournalCatalog _journalCatalog;
    private readonly ILogger _logger;
    private readonly Action<Guid> _onClosed;
    private readonly int _linkRetryCount;
    private readonly TimeSpan _linkRetryBackoff;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly object _gate = new();
    private readonly object _linkGate = new();

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
    private readonly Queue<long> _recentFrameTimestamps = new();
    private int _open = 1;
    private int _transportLost;
    /// <summary>Set once a Chromium <see cref="SessionNotificationKind.Crashed"/> is queued — blocks further DropOldest churn from evicting it.</summary>
    private int _crashQueued;

    public GrpcSessionConnection(
        Guid sessionId,
        BrowserSessionService.BrowserSessionServiceClient client,
        IConfigurationService configuration,
        IJournalCatalog journalCatalog,
        SidecarOptions options,
        ILogger logger,
        Action<Guid> onClosed)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(journalCatalog);
        SessionId = sessionId;
        _client = client;
        _configuration = configuration;
        _journalCatalog = journalCatalog;
        _logger = logger;
        _onClosed = onClosed;
        _linkRetryCount = options.LinkRetryCount;
        _linkRetryBackoff = options.LinkRetryBackoff;
    }

    public Guid SessionId { get; }

    public bool IsOpen => Volatile.Read(ref _open) == 1;

    /// <summary>
    /// Transient gRPC failures worth a short unary/watch reopen retry.
    /// Session-not-found is never retryable — use <see cref="IsSessionGone"/>.
    /// </summary>
    internal static bool ShouldRetry(StatusCode statusCode, string? detail)
    {
        if (statusCode is StatusCode.Unavailable)
        {
            return true;
        }

        if (statusCode is StatusCode.Unknown or StatusCode.Internal)
        {
            var text = detail ?? string.Empty;
            return text.Contains("ResponseEnded", StringComparison.OrdinalIgnoreCase)
                || text.Contains("ended prematurely", StringComparison.OrdinalIgnoreCase)
                || text.Contains("Unavailable", StringComparison.OrdinalIgnoreCase);
        }

        return false;
    }

    internal static bool ShouldRetry(RpcException ex)
        => ShouldRetry(ex.StatusCode, ex.Status.Detail ?? ex.Message);

    internal static bool IsSessionGone(RpcException ex)
    {
        if (ex.StatusCode is StatusCode.NotFound)
        {
            return true;
        }

        var detail = ex.Status.Detail ?? ex.Message;
        return detail.Contains("session not found", StringComparison.OrdinalIgnoreCase);
    }

    public Task StartStreamsAsync(CancellationToken ct)
    {
        EnsureOpen();
        ct.ThrowIfCancellationRequested();
        var token = _lifetime.Token;

        _pushInput = _client.PushInput(cancellationToken: token);
        _control = _client.Control(headers: CreateSessionMetadata(), cancellationToken: token);

        _ = PumpVideoAsync(token);
        _ = PumpConsoleAsync(token);
        _ = PumpLocationAsync(token);
        _ = PumpNavigationBlockedAsync(token);
        _ = PumpEditableFocusAsync(token);
        _ = PumpCrashAsync(token);
        _ = PumpInputPathAsync(token);
        _ = PumpControlAsync(token);
        return Task.CompletedTask;
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

            AsyncClientStreamingCall<InputEvent, ProtoEmpty>? push;
            AsyncDuplexStreamingCall<ControlToSidecar, ControlFromSidecar>? control;
            lock (_linkGate)
            {
                push = _pushInput;
                _pushInput = null;
                control = _control;
                _control = null;
            }

            if (push is not null)
            {
                try { await push.RequestStream.CompleteAsync(); } catch { /* */ }
                try { push.Dispose(); } catch { /* */ }
            }

            if (control is not null)
            {
                try { await control.RequestStream.CompleteAsync(); } catch { /* */ }
                try { control.Dispose(); } catch { /* */ }
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
        var policy = _configuration.GetCurrent().Sessions.ViewportPolicy;
        var validated = GrpcRequestValidation.ValidateLaunch(configuration, policy);
        if (validated.IsFailure)
        {
            return Result<BrowserReadyInfo>.Failure(validated.Errors.ToArray());
        }

        var (width, height) = validated.Value;
        return await CallValueAsync(async () =>
        {
            var ready = await WithLinkedAsync(ct, token =>
                _client.LaunchAsync(
                    GrpcSessionMappers.ToLaunchRequest(
                        SessionId,
                        width,
                        height,
                        configuration!,
                        policy),
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
        var policy = _configuration.GetCurrent().Sessions.ViewportPolicy;
        var validated = GrpcRequestValidation.ValidateResize(width, height, policy);
        if (validated.IsFailure)
        {
            var first = validated.Errors.FirstOrDefault();
            return Result<DomainResizeResult>.Success(new DomainResizeResult
            {
                Applied = false,
                Width = width,
                Height = height,
                DisplayWidth = policy.Maximum.Width,
                DisplayHeight = policy.Maximum.Height,
                ResizeId = requestId,
                ErrorCode = string.IsNullOrWhiteSpace(first?.Code)
                    ? "invalid_viewport"
                    : first.Code,
                Phase = "validate",
                Message = first?.Message
                    ?? string.Join("; ", validated.Errors.Select(e => e.Message)),
            });
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

    public async Task<IResult<SessionStatus>> GetStatusAsync(CancellationToken ct = default)
    {
        if (!IsOpen)
        {
            return Result<SessionStatus>.Failure("Connection closed");
        }

        return await CallValueAsync(async () =>
        {
            var status = await WithLinkedAsync(ct, token =>
                _client.GetStatusAsync(
                    new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                    cancellationToken: token).ResponseAsync);

            DomainEditingState? editing;
            double fps;
            lock (_gate)
            {
                editing = _editing;
                fps = ComputeCurrentFps();
            }

            return Result<SessionStatus>.Success(
                GrpcSessionMappers.ToSessionStatus(SessionId, status, editing, fps));
        });
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

    public IResult<Task> ConsumeUserInputAsync(ChannelReader<UserInput> channelReader)
    {
        CancellationToken lifetime;
        lock (_linkGate)
        {
            if (!IsOpen || _pushInput is null)
            {
                return Result<Task>.Failure("Connection closed");
            }

            try
            {
                lifetime = _lifetime.Token;
            }
            catch (ObjectDisposedException)
            {
                return Result<Task>.Failure("Connection closed");
            }
        }

        return Result<Task>.Success(PumpUserInputAsync(channelReader, lifetime));
    }

    public IResult<Task> ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader)
    {
        CancellationToken lifetime;
        try
        {
            if (!IsOpen)
            {
                return Result<Task>.Failure("Connection closed");
            }

            lifetime = _lifetime.Token;
        }
        catch (ObjectDisposedException)
        {
            return Result<Task>.Failure("Connection closed");
        }

        return Result<Task>.Success(PumpConsoleInputAsync(channelReader, lifetime));
    }

    private async Task PumpUserInputAsync(ChannelReader<UserInput> reader, CancellationToken ct)
    {
        await foreach (var userInput in reader.ReadAllAsync(ct))
        {
            if (!GrpcSessionMappers.TryParseInputEvent(SessionId, userInput, out var input)
                || input is null)
            {
                TryPublishNotification(new SessionNotification
                {
                    Kind = SessionNotificationKind.InputRejected,
                    ErrorCode = "input_invalid",
                    Phase = "validate",
                    Message = $"Invalid user input: {userInput.Type}",
                });
                continue;
            }

            try
            {
                await WriteInputWithRetryAsync(input, ct).ConfigureAwait(false);
                TryPublishNotification(new SessionNotification
                {
                    Kind = SessionNotificationKind.InputApplied,
                    InputKind = userInput.Type,
                    Phase = TryTouchPhase(userInput),
                });
                TryPublishInputPathTrace(
                    "Telemetry.Sessions.Input.SidecarPushWritten",
                    "grpc_pushed",
                    userInput.Type);
            }
            catch (RpcException ex) when (ex.StatusCode == StatusCode.Cancelled)
            {
                break;
            }
            catch (RpcException ex) when (IsSessionGone(ex))
            {
                _logger.LogWarning(
                    ex,
                    "PushInput session gone for session {SessionId}",
                    SessionId);
                await FaultSidecarConnectionAsync().ConfigureAwait(false);
                break;
            }
            catch (RpcException ex) when (ShouldRetry(ex))
            {
                // Exhausted WriteInput retries. Do not tear down the link or end the
                // drain — SessionInputMerger starts this pump once. Keep consuming so
                // later input can ReopenPushInput; Chromium death stays on WatchCrash.
                _logger.LogWarning(
                    ex,
                    "PushInput faulted for session {SessionId} after retries (link kept for WatchCrash)",
                    SessionId);
                TryPublishNotification(new SessionNotification
                {
                    Kind = SessionNotificationKind.InputRejected,
                    ErrorCode = "input_push_failed",
                    Phase = "push",
                    Message = ex.Status.Detail ?? ex.Message,
                });
                continue;
            }
            catch (RpcException ex)
            {
                TryPublishNotification(new SessionNotification
                {
                    Kind = SessionNotificationKind.InputRejected,
                    ErrorCode = "input_push_failed",
                    Phase = "push",
                    Message = ex.Status.Detail ?? ex.Message,
                });
            }
            catch (ObjectDisposedException)
            {
                break;
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private static string? TryTouchPhase(UserInput userInput)
    {
        if (!string.Equals(userInput.Type, "touch", StringComparison.Ordinal)
            || string.IsNullOrWhiteSpace(userInput.Payload))
        {
            return null;
        }

        try
        {
            using var doc = JsonDocument.Parse(userInput.Payload);
            if (doc.RootElement.TryGetProperty("phase", out var phase)
                && phase.ValueKind == JsonValueKind.String)
            {
                return phase.GetString();
            }
        }
        catch (JsonException)
        {
            // Ignore — phase is optional metadata for journal.
        }

        return null;
    }

    private async Task WriteInputWithRetryAsync(InputEvent input, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            IClientStreamWriter<InputEvent>? stream;
            lock (_linkGate)
            {
                stream = _pushInput?.RequestStream;
            }

            if (stream is null || !IsOpen)
            {
                throw new RpcException(new global::Grpc.Core.Status(StatusCode.Unavailable, "PushInput stream closed"));
            }

            try
            {
                await stream.WriteAsync(input, ct).ConfigureAwait(false);
                return;
            }
            catch (RpcException ex) when (ex.StatusCode == StatusCode.Cancelled)
            {
                throw;
            }
            catch (RpcException ex) when (ShouldRetry(ex) && attempt < _linkRetryCount && IsOpen)
            {
                _logger.LogWarning(
                    ex,
                    "PushInput retry {Attempt}/{Retries} (reopen stream) for session {SessionId}",
                    attempt + 1,
                    _linkRetryCount,
                    SessionId);
                await DelayLinkBackoffAsync(ct).ConfigureAwait(false);
                ReopenPushInput();
            }
        }
    }

    private void ReopenPushInput()
    {
        lock (_linkGate)
        {
            if (!IsOpen)
            {
                return;
            }

            CancellationToken lifetime;
            try
            {
                lifetime = _lifetime.Token;
            }
            catch (ObjectDisposedException)
            {
                return;
            }

            var previous = _pushInput;
            _pushInput = null;
            if (previous is not null)
            {
                try { previous.Dispose(); } catch { /* */ }
            }

            try
            {
                _pushInput = _client.PushInput(cancellationToken: lifetime);
            }
            catch (ObjectDisposedException)
            {
                /* Close raced */
            }
        }
    }

    private async Task PumpConsoleInputAsync(ChannelReader<ConsoleInput> reader, CancellationToken ct)
    {
        await foreach (var input in reader.ReadAllAsync(ct))
        {
            var codeValidation = GrpcRequestValidation.ValidateEvaluate(input.Code);
            if (codeValidation.IsFailure)
            {
                await _console.Writer.WriteAsync(
                    new ConsoleOutput
                    {
                        Kind = ConsoleOutputKind.EvalResult,
                        RequestId = input.Id,
                        Ok = false,
                        Error = string.Join(
                            "; ",
                            codeValidation.Errors.Select(e => e.Message)),
                    },
                    ct);
                continue;
            }

            try
            {
                var eval = await CallValueAsync(async () =>
                {
                    var result = await _client.EvaluateAsync(
                        new EvaluateRequest
                        {
                            SessionId = SessionId.ToString("D"),
                            Code = input.Code,
                        },
                        cancellationToken: ct);
                    return Result<EvaluateResult>.Success(result);
                }).ConfigureAwait(false);

                if (eval.IsFailure)
                {
                    await _console.Writer.WriteAsync(
                        new ConsoleOutput
                        {
                            Kind = ConsoleOutputKind.EvalResult,
                            RequestId = input.Id,
                            Ok = false,
                            Error = string.Join("; ", eval.Errors.Select(e => e.Message)),
                        },
                        ct);
                    continue;
                }

                await _console.Writer.WriteAsync(
                    GrpcSessionMappers.EvalResultToOutput(input.Id, eval.Value),
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

    private Task PumpVideoAsync(CancellationToken ct) =>
        RunWatchLoopAsync(
            "WatchVideo",
            token => _client.WatchVideo(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: token),
            async (frame, token) =>
            {
                var jpeg = frame.Jpeg.ToByteArray();
                var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                lock (_gate)
                {
                    _recentFrameTimestamps.Enqueue(nowMs);
                    TrimRecentFrames(nowMs);
                }
                var item = new Frame
                {
                    Jpeg = jpeg,
                    Sequence = Interlocked.Increment(ref _frameSequence),
                    Timestamp = nowMs,
                };
                await _frames.Writer.WriteAsync(item, token).ConfigureAwait(false);
            },
            ct);

    private double ComputeCurrentFps()
    {
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        TrimRecentFrames(nowMs);
        return _recentFrameTimestamps.Count;
    }

    private void TrimRecentFrames(long nowMs)
    {
        const long windowMs = 1_000;
        while (_recentFrameTimestamps.Count > 0 && nowMs - _recentFrameTimestamps.Peek() >= windowMs)
            _recentFrameTimestamps.Dequeue();
    }

    private Task PumpConsoleAsync(CancellationToken ct) =>
        RunWatchLoopAsync(
            "WatchConsole",
            token => _client.WatchConsole(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: token),
            async (ev, token) =>
            {
                await _console.Writer.WriteAsync(
                    GrpcSessionMappers.ConsoleEventToOutput(ev),
                    token).ConfigureAwait(false);
            },
            ct);

    private Task PumpLocationAsync(CancellationToken ct) =>
        RunWatchLoopAsync(
            "WatchLocation",
            token => _client.WatchLocation(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: token),
            async (ev, token) =>
            {
                TryPublishNotification(new SessionNotification
                {
                    Kind = SessionNotificationKind.LocationChanged,
                    Url = ev.Url,
                });
                await Task.CompletedTask.ConfigureAwait(false);
            },
            ct);

    private Task PumpNavigationBlockedAsync(CancellationToken ct) =>
        RunWatchLoopAsync(
            "WatchNavigationBlocked",
            token => _client.WatchNavigationBlocked(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: token),
            async (ev, token) =>
            {
                TryPublishNotification(new SessionNotification
                {
                    Kind = SessionNotificationKind.MainFrameNavigationBlocked,
                    Url = ev.Url,
                });
                await Task.CompletedTask.ConfigureAwait(false);
            },
            ct);

    private Task PumpEditableFocusAsync(CancellationToken ct) =>
        RunWatchLoopAsync(
            "WatchEditableFocus",
            token => _client.WatchEditableFocus(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: token),
            async (ev, token) =>
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

                TryPublishNotification(new SessionNotification
                {
                    Kind = SessionNotificationKind.EditableFocusChanged,
                    Editing = editing,
                });
                await Task.CompletedTask.ConfigureAwait(false);
            },
            ct);

    private Task PumpCrashAsync(CancellationToken ct) =>
        RunWatchLoopAsync(
            "WatchCrash",
            token => _client.WatchCrash(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: token),
            async (crash, token) =>
            {
                // True Chromium/session fault from sidecar onCrash.
                // Keep the sidecar link (and Watch* streams) open — only CloseAsync ends them.
                if (IsOpen)
                {
                    TryPublishNotification(new SessionNotification
                    {
                        Kind = SessionNotificationKind.Crashed,
                        ErrorCode = crash.ErrorCode,
                        Message = crash.Message,
                        Phase = crash.HasPhase ? crash.Phase : "runtime",
                    });
                }

                await Task.CompletedTask.ConfigureAwait(false);
            },
            ct);

    private Task PumpInputPathAsync(CancellationToken ct) =>
        RunWatchLoopAsync(
            "WatchInputPath",
            token => _client.WatchInputPath(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: token),
            async (ev, token) =>
            {
                TryPublishInputPathTrace(
                    "Telemetry.Sessions.Input.SidecarAdmitted",
                    "sidecar_admitted",
                    ev.Kind);
                await Task.CompletedTask.ConfigureAwait(false);
            },
            ct);

    /// <summary>
    /// Opt-in input-path hop. Skips the notification (and therefore Journal) when the
    /// catalog type is disabled — keeps the hot path quiet unless the operator toggles it.
    /// </summary>
    private void TryPublishInputPathTrace(string catalogType, string phase, string? inputKind)
    {
        if (string.IsNullOrWhiteSpace(inputKind)
            || !_journalCatalog.IsTypeEnabled(catalogType))
        {
            return;
        }

        TryPublishNotification(new SessionNotification
        {
            Kind = SessionNotificationKind.InputPathTrace,
            InputKind = inputKind.Trim(),
            Phase = phase,
        });
    }

    /// <summary>
    /// Queue a notification. After <see cref="SessionNotificationKind.Crashed"/> is queued,
    /// further non-crash items are dropped so DropOldest cannot evict the crash signal.
    /// </summary>
    private void TryPublishNotification(SessionNotification notification)
    {
        lock (_gate)
        {
            if (notification.Kind == SessionNotificationKind.Crashed)
            {
                Volatile.Write(ref _crashQueued, 1);
                _notifications.Writer.TryWrite(notification);
                return;
            }

            if (Volatile.Read(ref _crashQueued) != 0)
            {
                return;
            }

            _notifications.Writer.TryWrite(notification);
        }
    }

    private enum LinkProbeResult
    {
        Alive,
        BrowserClosed,
        Unreachable,
    }

    /// <summary>
    /// Pump one Watch* stream; if it ends while the link is still open, probe GetStatus and
    /// reopen that stream only (C# channels stay the same). Never emits Crashed.
    /// </summary>
    private async Task RunWatchLoopAsync<T>(
        string streamName,
        Func<CancellationToken, AsyncServerStreamingCall<T>> openCall,
        Func<T, CancellationToken, Task> onItem,
        CancellationToken ct)
    {
        while (IsOpen && !ct.IsCancellationRequested)
        {
            try
            {
                using var call = openCall(ct);
                await foreach (var item in call.ResponseStream.ReadAllAsync(ct).ConfigureAwait(false))
                {
                    await onItem(item, ct).ConfigureAwait(false);
                }

                if (!IsOpen || ct.IsCancellationRequested)
                {
                    return;
                }

                _logger.LogWarning(
                    "Sidecar {Stream} ended for session {SessionId}; probing before reopen",
                    streamName,
                    SessionId);

                var probe = await ProbeSessionLinkAsync(streamName, ct).ConfigureAwait(false);
                if (probe == LinkProbeResult.Unreachable)
                {
                    await FaultSidecarConnectionAsync().ConfigureAwait(false);
                    return;
                }

                // Alive or BrowserClosed: keep reopening. BrowserClosed covers mid-resize
                // (open=false during recreate) and lets WatchCrash drain onCrash after death.
                _logger.LogWarning(
                    "Sidecar {Stream} reopening for session {SessionId} (probe={Probe})",
                    streamName,
                    SessionId,
                    probe);
                await DelayLinkBackoffAsync(ct).ConfigureAwait(false);
                continue;
            }
            catch (ObjectDisposedException)
            {
                return;
            }
            catch (ChannelClosedException)
            {
                return;
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (RpcException ex) when (ex.StatusCode == StatusCode.Cancelled)
            {
                return;
            }
            catch (RpcException ex)
            {
                if (!IsOpen || ct.IsCancellationRequested)
                {
                    return;
                }

                _logger.LogWarning(
                    ex,
                    "Sidecar {Stream} error for session {SessionId}",
                    streamName,
                    SessionId);

                if (IsSessionGone(ex))
                {
                    await FaultSidecarConnectionAsync().ConfigureAwait(false);
                    return;
                }

                var probe = await ProbeSessionLinkAsync(streamName, ct).ConfigureAwait(false);
                if (probe == LinkProbeResult.Unreachable)
                {
                    await FaultSidecarConnectionAsync().ConfigureAwait(false);
                    return;
                }

                _logger.LogWarning(
                    "Sidecar {Stream} reopening after error for session {SessionId} (probe={Probe})",
                    streamName,
                    SessionId,
                    probe);
                await DelayLinkBackoffAsync(ct).ConfigureAwait(false);
                continue;
            }
        }
    }

    /// <summary>
    /// Unary GetStatus probe with the same retry budget. Does not emit Crashed.
    /// </summary>
    private async Task<LinkProbeResult> ProbeSessionLinkAsync(string streamName, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            if (!IsOpen || ct.IsCancellationRequested)
            {
                return LinkProbeResult.Unreachable;
            }

            try
            {
                var status = await WithLinkedAsync(ct, token =>
                    _client.GetStatusAsync(
                        new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                        cancellationToken: token).ResponseAsync).ConfigureAwait(false);

                if (!status.IsOpen)
                {
                    _logger.LogWarning(
                        "Sidecar session {SessionId} browser closed while probing after {Stream}",
                        SessionId,
                        streamName);
                    return LinkProbeResult.BrowserClosed;
                }

                return LinkProbeResult.Alive;
            }
            catch (OperationCanceledException)
            {
                return LinkProbeResult.Unreachable;
            }
            catch (RpcException ex) when (ex.StatusCode == StatusCode.Cancelled)
            {
                return LinkProbeResult.Unreachable;
            }
            catch (RpcException ex)
            {
                if (IsSessionGone(ex))
                {
                    _logger.LogWarning(
                        ex,
                        "Sidecar session {SessionId} gone while probing after {Stream}",
                        SessionId,
                        streamName);
                    return LinkProbeResult.Unreachable;
                }

                if (ShouldRetry(ex) && attempt < _linkRetryCount)
                {
                    _logger.LogWarning(
                        ex,
                        "Sidecar GetStatus probe retry {Attempt}/{Retries} after {Stream} for session {SessionId}",
                        attempt + 1,
                        _linkRetryCount,
                        streamName,
                        SessionId);
                    await DelayLinkBackoffAsync(ct).ConfigureAwait(false);
                    continue;
                }

                _logger.LogWarning(
                    ex,
                    "Sidecar GetStatus probe failed after {Stream} for session {SessionId}",
                    streamName,
                    SessionId);
                return LinkProbeResult.Unreachable;
            }
            catch (ObjectDisposedException)
            {
                return LinkProbeResult.Unreachable;
            }
        }
    }

    /// <summary>
    /// Unrecoverable break of the API↔sidecar session link. Completes local channels via
    /// <see cref="CloseAsync"/> so live session teardown can observe connection end.
    /// Does <b>not</b> emit <see cref="SessionNotificationKind.Crashed"/> — that kind is reserved
    /// for sidecar <c>onCrash</c> / <c>WatchCrash</c> (Chromium), not transport.
    /// </summary>
    private Task FaultSidecarConnectionAsync()
    {
        if (!IsOpen)
        {
            return Task.CompletedTask;
        }

        if (Interlocked.Exchange(ref _transportLost, 1) != 0)
        {
            return Task.CompletedTask;
        }

        _logger.LogWarning("Sidecar link faulted for session {SessionId}; closing connection", SessionId);
        return CloseAsync(CancellationToken.None);
    }

    private async Task PumpControlAsync(CancellationToken ct)
    {
        while (IsOpen && !ct.IsCancellationRequested)
        {
            AsyncDuplexStreamingCall<ControlToSidecar, ControlFromSidecar>? call;
            lock (_linkGate)
            {
                call = _control;
            }

            if (call is null)
            {
                try
                {
                    var opened = _client.Control(headers: CreateSessionMetadata(), cancellationToken: ct);
                    lock (_linkGate)
                    {
                        if (!IsOpen)
                        {
                            try { opened.Dispose(); } catch { /* */ }
                            return;
                        }

                        _control = opened;
                        call = opened;
                    }
                }
                catch (ObjectDisposedException)
                {
                    return;
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (RpcException ex) when (ex.StatusCode == StatusCode.Cancelled)
                {
                    return;
                }
                catch (RpcException ex)
                {
                    _logger.LogWarning(ex, "Sidecar Control open failed for session {SessionId}", SessionId);
                    if (IsSessionGone(ex))
                    {
                        await FaultSidecarConnectionAsync().ConfigureAwait(false);
                        return;
                    }

                    var openProbe = await ProbeSessionLinkAsync("Control", ct).ConfigureAwait(false);
                    if (openProbe == LinkProbeResult.Unreachable)
                    {
                        await FaultSidecarConnectionAsync().ConfigureAwait(false);
                        return;
                    }

                    await DelayLinkBackoffAsync(ct).ConfigureAwait(false);
                    continue;
                }
            }

            try
            {
                await foreach (var msg in call.ResponseStream.ReadAllAsync(ct).ConfigureAwait(false))
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
                            var decision = await handler(ct).ConfigureAwait(false);
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
                        ct).ConfigureAwait(false);
                }

                if (!IsOpen || ct.IsCancellationRequested)
                {
                    return;
                }

                _logger.LogWarning(
                    "Sidecar Control ended for session {SessionId}; probing before reopen",
                    SessionId);
                DisposeControlCall();

                var endedProbe = await ProbeSessionLinkAsync("Control", ct).ConfigureAwait(false);
                if (endedProbe == LinkProbeResult.Unreachable)
                {
                    await FaultSidecarConnectionAsync().ConfigureAwait(false);
                    return;
                }

                await DelayLinkBackoffAsync(ct).ConfigureAwait(false);
                continue;
            }
            catch (ObjectDisposedException)
            {
                return;
            }
            catch (ChannelClosedException)
            {
                return;
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (RpcException ex) when (ex.StatusCode == StatusCode.Cancelled)
            {
                return;
            }
            catch (RpcException ex)
            {
                if (!IsOpen || ct.IsCancellationRequested)
                {
                    return;
                }

                _logger.LogWarning(ex, "Sidecar Control error for session {SessionId}", SessionId);
                DisposeControlCall();

                if (IsSessionGone(ex))
                {
                    await FaultSidecarConnectionAsync().ConfigureAwait(false);
                    return;
                }

                var errorProbe = await ProbeSessionLinkAsync("Control", ct).ConfigureAwait(false);
                if (errorProbe == LinkProbeResult.Unreachable)
                {
                    await FaultSidecarConnectionAsync().ConfigureAwait(false);
                    return;
                }

                await DelayLinkBackoffAsync(ct).ConfigureAwait(false);
                continue;
            }
        }
    }

    private void DisposeControlCall()
    {
        AsyncDuplexStreamingCall<ControlToSidecar, ControlFromSidecar>? call;
        lock (_linkGate)
        {
            call = _control;
            _control = null;
        }

        if (call is null)
        {
            return;
        }

        try { call.Dispose(); } catch { /* */ }
    }

    private async Task<T> WithLinkedAsync<T>(CancellationToken ct, Func<CancellationToken, Task<T>> action)
    {
        using var linked = CreateLifetimeLink(ct);
        return await action(linked.Token);
    }

    private CancellationTokenSource CreateLifetimeLink(CancellationToken ct)
    {
        try
        {
            return CancellationTokenSource.CreateLinkedTokenSource(ct, _lifetime.Token);
        }
        catch (ObjectDisposedException)
        {
            throw new OperationCanceledException(ct);
        }
    }

    private Metadata CreateSessionMetadata() =>
        new() { { "x-session-id", SessionId.ToString("D") } };

    private void EnsureOpen()
    {
        if (!IsOpen)
        {
            throw new InvalidOperationException("Connection closed");
        }
    }

    /// <summary>
    /// Backoff between link retries. Safe after <see cref="CloseAsync"/> disposes
    /// <c>_lifetime</c> — does not re-read <c>_lifetime.Token</c> when a usable
    /// <paramref name="preferred"/> token is supplied.
    /// </summary>
    private async Task DelayLinkBackoffAsync(CancellationToken preferred = default)
    {
        CancellationToken token;
        try
        {
            token = preferred.CanBeCanceled ? preferred : _lifetime.Token;
        }
        catch (ObjectDisposedException)
        {
            return;
        }

        try
        {
            await Task.Delay(_linkRetryBackoff, token).ConfigureAwait(false);
        }
        catch (ObjectDisposedException)
        {
            // CTS disposed mid-delay / callback registration.
        }
        catch (OperationCanceledException)
        {
            // Close in flight — caller checks IsOpen / ct.
        }
    }

    private async Task<IResult> CallAsync(Func<Task<IResult>> action)
    {
        if (!IsOpen) return Result.Failure("Connection closed");
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return await action();
            }
            catch (ObjectDisposedException)
            {
                return Result.Failure("Connection closed");
            }
            catch (OperationCanceledException)
            {
                return Result.Failure("Connection closed");
            }
            catch (RpcException ex)
            {
                if (IsSessionGone(ex))
                {
                    _logger.LogWarning(ex, "Sidecar session {SessionId} gone on unary call", SessionId);
                    await FaultSidecarConnectionAsync().ConfigureAwait(false);
                    return Result.Failure(ex.Status.Detail ?? ex.Message);
                }

                if (ShouldRetry(ex) && attempt < _linkRetryCount && IsOpen)
                {
                    _logger.LogWarning(
                        ex,
                        "Sidecar unary retry {Attempt}/{Retries} for session {SessionId}",
                        attempt + 1,
                        _linkRetryCount,
                        SessionId);
                    await DelayLinkBackoffAsync().ConfigureAwait(false);
                    if (!IsOpen)
                    {
                        return Result.Failure("Connection closed");
                    }

                    continue;
                }

                if (ShouldRetry(ex))
                {
                    // Exhausted retries — only tear down when the session link is unreachable.
                    // BrowserClosed / Alive keep WatchCrash able to deliver Crashed.
                    var probe = await ProbeSessionLinkAsync("Unary", CancellationToken.None)
                        .ConfigureAwait(false);
                    if (probe == LinkProbeResult.Unreachable)
                    {
                        await FaultSidecarConnectionAsync().ConfigureAwait(false);
                    }
                }

                return Result.Failure(ex.Status.Detail ?? ex.Message);
            }
        }
    }

    private async Task<IResult<T>> CallValueAsync<T>(Func<Task<Result<T>>> action)
    {
        if (!IsOpen) return Result<T>.Failure("Connection closed");
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return await action();
            }
            catch (ObjectDisposedException)
            {
                return Result<T>.Failure("Connection closed");
            }
            catch (OperationCanceledException)
            {
                return Result<T>.Failure("Connection closed");
            }
            catch (RpcException ex)
            {
                if (IsSessionGone(ex))
                {
                    _logger.LogWarning(ex, "Sidecar session {SessionId} gone on unary call", SessionId);
                    await FaultSidecarConnectionAsync().ConfigureAwait(false);
                    return Result<T>.Failure(ex.Status.Detail ?? ex.Message);
                }

                if (ShouldRetry(ex) && attempt < _linkRetryCount && IsOpen)
                {
                    _logger.LogWarning(
                        ex,
                        "Sidecar unary retry {Attempt}/{Retries} for session {SessionId}",
                        attempt + 1,
                        _linkRetryCount,
                        SessionId);
                    await DelayLinkBackoffAsync().ConfigureAwait(false);
                    if (!IsOpen)
                    {
                        return Result<T>.Failure("Connection closed");
                    }

                    continue;
                }

                if (ShouldRetry(ex))
                {
                    var probe = await ProbeSessionLinkAsync("Unary", CancellationToken.None)
                        .ConfigureAwait(false);
                    if (probe == LinkProbeResult.Unreachable)
                    {
                        await FaultSidecarConnectionAsync().ConfigureAwait(false);
                    }
                }

                return Result<T>.Failure(ex.Status.Detail ?? ex.Message);
            }
        }
    }
}
