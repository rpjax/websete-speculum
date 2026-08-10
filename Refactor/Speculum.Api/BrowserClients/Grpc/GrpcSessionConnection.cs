using Speculum.Api.Sessions.Services.Streaming;
using System.Threading.Channels;
using Aidan.Core.Patterns;
using Grpc.Core;
using Microsoft.Extensions.Logging;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Configurations.Models.Sidecar;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sidecar.V1;
using Speculum.Api.Telemetry;
using DomainCookieNormalizeStats = Speculum.Api.Sessions.Models.CookieNormalizeStats;
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

    private readonly Channel<PageProjectionDiff> _domDiffs = SequencedDiffChannels.Create<PageProjectionDiff>();

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
    private AsyncClientStreamingCall<DomInputEvent, ProtoEmpty>? _pushDomInput;
    private AsyncDuplexStreamingCall<ControlToSidecar, ControlFromSidecar>? _control;
    private MirrorMode _mirrorMode = MirrorMode.VideoStreaming;
    private DomainEditingState? _editing;
    private Func<CancellationToken, Task<PermissionDecision>>? _cameraPermissionHandler;
    private Func<CancellationToken, Task<PermissionDecision>>? _microphonePermissionHandler;
    private long _frameSequence;
    private readonly Queue<long> _recentFrameTimestamps = new();
    private int _open = 1;
    private int _transportLost;
    /// <summary>Set once a Chromium <see cref="SessionNotificationKind.Crashed"/> is queued — blocks further DropOldest churn from evicting it.</summary>
    private int _crashQueued;
    private IPageProjectionDiffTelemetry? _diffTelemetry;

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

        _mirrorMode = _configuration.GetCurrent().Sessions.MirrorMode;
        if (_mirrorMode == MirrorMode.VideoStreaming)
        {
            _pushInput = _client.PushInput(cancellationToken: token);
            _ = PumpVideoAsync(token);
        }
        else
        {
            _pushDomInput = _client.PushDomInput(cancellationToken: token);
            _ = PumpDomAsync(token);
        }

        _control = _client.Control(headers: CreateSessionMetadata(), cancellationToken: token);

        _ = PumpConsoleAsync(token);
        _ = PumpLocationAsync(token);
        _ = PumpNavigationBlockedAsync(token);
        _ = PumpEditableFocusAsync(token);
        _ = PumpCrashAsync(token);
        _ = PumpVideoStreamingInputPathAsync(token);
        _ = PumpPageProjectionIntentPathAsync(token);
        _ = PumpPageProjectionLifecycleAsync(token);
        _ = PumpAllocationLifecycleAsync(token);
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
            AsyncClientStreamingCall<DomInputEvent, ProtoEmpty>? pushDom;
            AsyncDuplexStreamingCall<ControlToSidecar, ControlFromSidecar>? control;
            lock (_linkGate)
            {
                push = _pushInput;
                _pushInput = null;
                pushDom = _pushDomInput;
                _pushDomInput = null;
                control = _control;
                _control = null;
            }

            if (push is not null)
            {
                try { await push.RequestStream.CompleteAsync(); } catch { /* */ }
                try { push.Dispose(); } catch { /* */ }
            }

            if (pushDom is not null)
            {
                try { await pushDom.RequestStream.CompleteAsync(); } catch { /* */ }
                try { pushDom.Dispose(); } catch { /* */ }
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
            _domDiffs.Writer.TryComplete();
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
        var sessions = _configuration.GetCurrent().Sessions;
        _mirrorMode = sessions.MirrorMode;
        var policy = sessions.ViewportPolicy;
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
                        policy,
                        sessions.ScreencastPolicy.MaxEncodeScale,
                        sessions.MirrorMode),
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

    public async Task<IResult<DomainCookieNormalizeStats>> RestoreProfileStateAsync(
        ProfileState state,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(state);
        return await CallValueAsync(async () =>
        {
            var response = await WithLinkedAsync(ct, token =>
                _client.RestoreStateAsync(
                    GrpcSessionMappers.ToRestoreRequest(SessionId, state),
                    cancellationToken: token).ResponseAsync);
            return Result<DomainCookieNormalizeStats>.Success(
                GrpcSessionMappers.ToCookieNormalizeStats(response?.CookieNormalize));
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
        var sessions = _configuration.GetCurrent().Sessions;
        var policy = sessions.ViewportPolicy;
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
                ScreencastMaxEncodeScale = GrpcSessionMappers.ClampScreencastMaxEncodeScale(
                    sessions.ScreencastPolicy.MaxEncodeScale),
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

    public IResult<ChannelReader<PageProjectionDiff>> GetPageProjectionDiffReader()
    {
        if (!IsOpen) return Result<ChannelReader<PageProjectionDiff>>.Failure("Connection closed");
        return Result<ChannelReader<PageProjectionDiff>>.Success(_domDiffs.Reader);
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

    public IResult<Task> ConsumeVideoStreamingInputAsync(ChannelReader<VideoStreamingInput> channelReader)
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

        return Result<Task>.Success(PumpVideoStreamingInputAsync(channelReader, lifetime));
    }

    public IResult<Task> ConsumePageProjectionIntentAsync(ChannelReader<PageProjectionIntent> channelReader)
    {
        CancellationToken lifetime;
        lock (_linkGate)
        {
            if (!IsOpen || _pushDomInput is null)
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

        return Result<Task>.Success(PumpPageProjectionIntentAsync(channelReader, lifetime));
    }

    public async Task<IResult<DomAsset>> GetDomAssetAsync(
        string key,
        CancellationToken ct = default,
        string? kind = null,
        string? rangeHeader = null)
    {
        if (string.IsNullOrWhiteSpace(key))
        {
            return Result<DomAsset>.Failure("Asset key is required");
        }

        return await CallValueAsync(async () =>
        {
            var response = await WithLinkedAsync(ct, token =>
                _client.GetDomAssetAsync(
                    new GetDomAssetRequest
                    {
                        SessionId = SessionId.ToString("D"),
                        Key = key.Trim(),
                        Kind = kind ?? "",
                        RangeHeader = rangeHeader ?? "",
                    },
                    cancellationToken: token).ResponseAsync);
            return Result<DomAsset>.Success(GrpcSessionMappers.ToDomAsset(response));
        });
    }

    public async Task<IResult<PageProjectionResyncSnapshot>> GetPageProjectionResyncAsync(
        long generation,
        long sequence,
        CancellationToken ct = default)
    {
        return await CallValueAsync(async () =>
        {
            var response = await WithLinkedAsync(ct, token =>
                _client.GetPageProjectionResyncAsync(
                    new PageProjectionResyncRequest
                    {
                        SessionId = SessionId.ToString("D"),
                        Generation = generation,
                        Sequence = sequence,
                    },
                    cancellationToken: token).ResponseAsync);
            return Result<PageProjectionResyncSnapshot>.Success(new PageProjectionResyncSnapshot
            {
                Generation = response.Generation,
                CoversThroughSequence = response.CoversThroughSequence,
                RootJson = response.RootJson.ToByteArray(),
                SheetsJson = response.SheetsJson.ToByteArray(),
            });
        });
    }

    public async Task<IResult> PutDomUploadAsync(
        string uploadId,
        byte[] body,
        string contentType,
        string name,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(uploadId) || body is null || body.Length == 0)
        {
            return Result.Failure("Upload id and body are required");
        }

        return await CallAsync(async () =>
        {
            await WithLinkedAsync(ct, token =>
                _client.PutDomUploadAsync(
                    new PutDomUploadRequest
                    {
                        SessionId = SessionId.ToString("D"),
                        UploadId = uploadId.Trim(),
                        Body = Google.Protobuf.ByteString.CopyFrom(body),
                        ContentType = string.IsNullOrWhiteSpace(contentType)
                            ? "application/octet-stream"
                            : contentType,
                        Name = string.IsNullOrWhiteSpace(name) ? "file" : name,
                    },
                    cancellationToken: token).ResponseAsync);
            return Result.Success();
        });
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

    private async Task PumpVideoStreamingInputAsync(ChannelReader<VideoStreamingInput> reader, CancellationToken ct)
    {
        await foreach (var userInput in reader.ReadAllAsync(ct))
        {
            if (!GrpcSessionMappers.TryParseInputEvent(SessionId, userInput, out var input)
                || input is null)
            {
                TryPublishVideoStreamingInputRejected(
                    "input_invalid",
                    "validate",
                    $"Invalid user input: {userInput.Type}",
                    userInput.TraceId,
                    userInput.ClientTimestampMs);
                continue;
            }

            try
            {
                await WriteInputWithRetryAsync(input, ct).ConfigureAwait(false);
                // Product HF admission policy is unchanged; Journal/Applied always emit when catalog on.
                TryPublishVideoStreamingInputApplied(
                    userInput.Type,
                    VideoStreamingInputAdmitPolicy.TryTouchPhase(userInput),
                    userInput.TraceId,
                    userInput.ClientTimestampMs);
                TryPublishVideoStreamingInputPathTrace(
                    TelemetryJournalFacts.VideoStreamingInputSidecarPushWritten,
                    "grpc_pushed",
                    userInput.Type,
                    userInput.TraceId,
                    userInput.ClientTimestampMs);
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
                TryPublishVideoStreamingInputRejected(
                    "input_push_failed",
                    "push",
                    ex.Status.Detail ?? ex.Message,
                    userInput.TraceId,
                    userInput.ClientTimestampMs);
                continue;
            }
            catch (RpcException ex)
            {
                TryPublishVideoStreamingInputRejected(
                    "input_push_failed",
                    "push",
                    ex.Status.Detail ?? ex.Message,
                    userInput.TraceId,
                    userInput.ClientTimestampMs);
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

    private async Task PumpPageProjectionIntentAsync(ChannelReader<PageProjectionIntent> reader, CancellationToken ct)
    {
        await foreach (var domInput in reader.ReadAllAsync(ct))
        {
            var clientTimestampMs = DomClientTimestampMs(domInput.TimestampClient);
            if (!GrpcSessionMappers.TryParseDomInputEvent(SessionId, domInput, out var input)
                || input is null)
            {
                TryPublishPageProjectionIntentRejected(
                    "input_invalid",
                    "validate",
                    $"Invalid dom input: {domInput.Type}",
                    domInput.Generation,
                    domInput.Anchor,
                    domInput.TraceId,
                    clientTimestampMs);
                continue;
            }

            try
            {
                await WriteDomInputWithRetryAsync(input, ct).ConfigureAwait(false);
                TryPublishPageProjectionIntentApplied(
                    domInput.Type,
                    "push",
                    domInput.Generation,
                    domInput.Anchor,
                    domInput.TraceId,
                    clientTimestampMs);
                TryPublishPageProjectionIntentPathTrace(
                    TelemetryJournalFacts.PageProjectionIntentSidecarPushWritten,
                    "grpc_pushed",
                    domInput.Type,
                    domInput.Generation,
                    domInput.Anchor,
                    domInput.TraceId,
                    clientTimestampMs);
            }
            catch (RpcException ex) when (ex.StatusCode == StatusCode.Cancelled)
            {
                break;
            }
            catch (RpcException ex) when (IsSessionGone(ex))
            {
                _logger.LogWarning(
                    ex,
                    "PushDomInput session gone for session {SessionId}",
                    SessionId);
                await FaultSidecarConnectionAsync().ConfigureAwait(false);
                break;
            }
            catch (RpcException ex) when (ShouldRetry(ex))
            {
                _logger.LogWarning(
                    ex,
                    "PushDomInput faulted for session {SessionId} after retries (link kept for WatchCrash)",
                    SessionId);
                TryPublishPageProjectionIntentRejected(
                    "input_push_failed",
                    "push",
                    ex.Status.Detail ?? ex.Message,
                    domInput.Generation,
                    domInput.Anchor,
                    domInput.TraceId,
                    clientTimestampMs);
                continue;
            }
            catch (RpcException ex)
            {
                TryPublishPageProjectionIntentRejected(
                    "input_push_failed",
                    "push",
                    ex.Status.Detail ?? ex.Message,
                    domInput.Generation,
                    domInput.Anchor,
                    domInput.TraceId,
                    clientTimestampMs);
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

    private async Task WriteDomInputWithRetryAsync(DomInputEvent input, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            IClientStreamWriter<DomInputEvent>? stream;
            lock (_linkGate)
            {
                stream = _pushDomInput?.RequestStream;
            }

            if (stream is null || !IsOpen)
            {
                throw new RpcException(new global::Grpc.Core.Status(StatusCode.Unavailable, "PushDomInput stream closed"));
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
                    "PushDomInput retry {Attempt}/{Retries} (reopen stream) for session {SessionId}",
                    attempt + 1,
                    _linkRetryCount,
                    SessionId);
                await DelayLinkBackoffAsync(ct).ConfigureAwait(false);
                ReopenPushDomInput();
            }
        }
    }

    private void ReopenPushDomInput()
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

            var previous = _pushDomInput;
            _pushDomInput = null;
            if (previous is not null)
            {
                try { previous.Dispose(); } catch { /* */ }
            }

            try
            {
                _pushDomInput = _client.PushDomInput(cancellationToken: lifetime);
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

    private Task PumpDomAsync(CancellationToken ct) =>
        RunWatchLoopAsync(
            "WatchPageProjectionDiff",
            token => _client.WatchPageProjectionDiff(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: token),
            async (frame, token) =>
            {
                if (GrpcSessionMappers.ToPageProjectionDiff(frame) is not { } diff)
                {
                    TryPublishPageProjectionDiffQueueDropped(
                        "mapper_rejected",
                        droppedCount: 1,
                        capacity: 0,
                        kept: null,
                        lowestDroppedSequence: frame.Sequence,
                        highestDroppedSequence: frame.Sequence,
                        plane: frame.Plane,
                        operation: frame.Operation,
                        generation: frame.Generation,
                        reason: "ToPageProjectionDiff_null");
                    return;
                }

                TryPublishPageProjectionDiffFrame(diff);
                var (dropped, lowest, highest) = await SequencedDiffChannels
                    .WriteDropAllOnOverflowDetailedAsync(
                        _domDiffs,
                        SequencedDiffChannels.DefaultCapacity,
                        diff,
                        token).ConfigureAwait(false);
                if (dropped > 0)
                {
                    TryPublishPageProjectionDiffQueueDropped(
                        "api_sequenced",
                        dropped,
                        SequencedDiffChannels.DefaultCapacity,
                        diff,
                        lowest,
                        highest);
                }
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

    private Task PumpVideoStreamingInputPathAsync(CancellationToken ct) =>
        RunWatchLoopAsync(
            "WatchVideoStreamingInputPath",
            token => _client.WatchVideoStreamingInputPath(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: token),
            async (ev, token) =>
            {
                TryPublishVideoStreamingInputPathTrace(
                    TelemetryJournalFacts.VideoStreamingInputSidecarAdmitted,
                    "sidecar_admitted",
                    ev.Kind);
                await Task.CompletedTask.ConfigureAwait(false);
            },
            ct);

    private Task PumpPageProjectionIntentPathAsync(CancellationToken ct) =>
        RunWatchLoopAsync(
            "WatchPageProjectionInputPath",
            token => _client.WatchPageProjectionInputPath(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: token),
            async (ev, token) =>
            {
                var phase = (ev.Phase ?? string.Empty).Trim();
                if (string.Equals(phase, "cdp_dropped", StringComparison.Ordinal))
                {
                    TryPublishPageProjectionIntentPathTrace(
                        TelemetryJournalFacts.PageProjectionIntentCdpDropped,
                        "cdp_dropped",
                        ev.Kind,
                        ev.HasGeneration ? ev.Generation : null,
                        null,
                        reason: ev.HasReason ? ev.Reason : null);
                }
                else
                {
                    TryPublishPageProjectionIntentPathTrace(
                        TelemetryJournalFacts.PageProjectionIntentSidecarAdmitted,
                        "sidecar_admitted",
                        ev.Kind,
                        ev.HasGeneration ? ev.Generation : null,
                        null);
                }

                await Task.CompletedTask.ConfigureAwait(false);
            },
            ct);

    private Task PumpPageProjectionLifecycleAsync(CancellationToken ct) =>
        RunWatchLoopAsync(
            "WatchPageProjectionLifecycle",
            token => _client.WatchPageProjectionLifecycle(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: token),
            async (ev, token) =>
            {
                TryPublishPageProjectionLifecycle(ev);
                await Task.CompletedTask.ConfigureAwait(false);
            },
            ct);

    private Task PumpAllocationLifecycleAsync(CancellationToken ct) =>
        RunWatchLoopAsync(
            "WatchAllocationLifecycle",
            token => _client.WatchAllocationLifecycle(
                new ProtoSessionId { SessionId_ = SessionId.ToString("D") },
                cancellationToken: token),
            async (ev, token) =>
            {
                TryPublishAllocationLifecycle(ev);
                await Task.CompletedTask.ConfigureAwait(false);
            },
            ct);

    private void TryPublishAllocationLifecycle(AllocationLifecycleEvent ev)
    {
        if (string.IsNullOrWhiteSpace(ev.Kind))
        {
            return;
        }

        var catalogType = ev.Kind.Trim() switch
        {
            "session_allocated" => "Telemetry.Sessions.Sidecar.SessionAllocated",
            "session_released" => "Telemetry.Sessions.Sidecar.SessionReleased",
            "display_allocated" => "Telemetry.Sessions.Sidecar.DisplayAllocated",
            "display_released" => "Telemetry.Sessions.Sidecar.DisplayReleased",
            "allocation_faulted" => "Telemetry.Sessions.Sidecar.AllocationFaulted",
            _ => null,
        };

        if (catalogType is null || !_journalCatalog.IsTypeEnabled(catalogType))
        {
            return;
        }

        TryPublishNotification(new SessionNotification
        {
            Kind = SessionNotificationKind.AllocationLifecycle,
            AllocationKind = ev.Kind.Trim(),
            DisplayWidth = ev.HasDisplayWidth ? ev.DisplayWidth : null,
            DisplayHeight = ev.HasDisplayHeight ? ev.DisplayHeight : null,
            LogicalWidth = ev.HasLogicalWidth ? ev.LogicalWidth : null,
            LogicalHeight = ev.HasLogicalHeight ? ev.LogicalHeight : null,
            InputBackend = ev.HasInputBackend ? ev.InputBackend : null,
            ErrorCode = ev.HasErrorCode ? ev.ErrorCode : null,
            Phase = ev.HasPhase ? ev.Phase : null,
            Reason = ev.HasReason ? ev.Reason : null,
        });
    }

    private void TryPublishPageProjectionLifecycle(PageProjectionLifecycleEvent ev)
    {
        var kind = (ev.Kind ?? string.Empty).Trim();
        if (string.Equals(kind, "generation_bumped", StringComparison.Ordinal))
        {
            // Correctness path: Projected must disarm before document/install for the
            // new generation. Never gate this on the telemetry catalog.
            if (string.IsNullOrWhiteSpace(ev.Reason))
            {
                return;
            }

            TryPublishNotification(new SessionNotification
            {
                Kind = SessionNotificationKind.PageProjectionLifecycle,
                Phase = "generation_bumped",
                Reason = ev.Reason.Trim(),
                DomFromGeneration = ev.FromGeneration,
                DomGeneration = ev.ToGeneration,
                Url = ev.HasUrl ? ev.Url : null,
                PageProjectionDiffPlane = ev.HasDiffKind ? ev.DiffKind : null,
            });
            return;
        }

        if (string.Equals(kind, "queue_dropped", StringComparison.Ordinal))
        {
            if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionDiffQueueDropped))
            {
                return;
            }

            // Sidecar packs stage in reason; plane in url; operation in diff_kind.
            var stage = string.IsNullOrWhiteSpace(ev.Reason) ? "sidecar_bridge" : ev.Reason.Trim();
            var dropped = ev.HasDroppedCount ? ev.DroppedCount : 0;
            if (dropped <= 0)
            {
                return;
            }

            TryPublishPageProjectionDiffQueueDropped(
                stage,
                dropped,
                ev.HasCapacity ? ev.Capacity : 0,
                kept: null,
                ev.HasLowestDroppedSequence ? ev.LowestDroppedSequence : null,
                ev.HasHighestDroppedSequence ? ev.HighestDroppedSequence : null,
                plane: ev.HasUrl ? ev.Url : null,
                operation: ev.HasDiffKind ? ev.DiffKind : null,
                generation: ev.ToGeneration != 0 ? ev.ToGeneration : null,
                sequenceOverride: ev.HasSequence ? ev.Sequence : null);
            return;
        }

        if (string.Equals(kind, "soft_nav_observed", StringComparison.Ordinal))
        {
            if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionDiffSoftNavObserved))
            {
                return;
            }

            TryPublishNotification(new SessionNotification
            {
                Kind = SessionNotificationKind.PageProjectionLifecycle,
                Phase = "soft_nav_observed",
                Url = ev.HasUrl ? ev.Url : null,
                DomGeneration = ev.ToGeneration,
                Reason = string.IsNullOrWhiteSpace(ev.Reason) ? null : ev.Reason,
                PageProjectionDiffOperation = ev.HasDiffKind ? ev.DiffKind : null,
            });
            return;
        }

        if (string.Equals(kind, "scroll_echo_hit", StringComparison.Ordinal))
        {
            if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionIntentScrollEchoHit))
            {
                return;
            }

            TryPublishNotification(new SessionNotification
            {
                Kind = SessionNotificationKind.PageProjectionLifecycle,
                Phase = "scroll_echo_hit",
                InputKind = string.IsNullOrWhiteSpace(ev.Reason) ? null : ev.Reason,
                DomAnchor = ev.HasUrl ? ev.Url : null,
                DomGeneration = ev.ToGeneration != 0 ? ev.ToGeneration : null,
                Reason = ev.HasDiffKind ? ev.DiffKind : null,
            });
        }
    }

    public void BindPageProjectionDiffTelemetry(IPageProjectionDiffTelemetry? telemetry)
        => Volatile.Write(ref _diffTelemetry, telemetry);

    public void ReportPageProjectionDiffQueueDropped(
        string stage,
        int droppedCount,
        int capacity,
        long? sequence = null,
        long? generation = null,
        string? plane = null,
        string? operation = null,
        long? lowestDroppedSequence = null,
        long? highestDroppedSequence = null,
        string? reason = null)
    {
        TryPublishPageProjectionDiffQueueDropped(
            stage,
            droppedCount,
            capacity,
            kept: null,
            lowestDroppedSequence,
            highestDroppedSequence,
            plane,
            operation,
            generation,
            reason,
            sequenceOverride: sequence);
    }

    private void TryPublishPageProjectionDiffQueueDropped(
        string stage,
        int droppedCount,
        int capacity,
        PageProjectionDiff? kept,
        long? lowestDroppedSequence = null,
        long? highestDroppedSequence = null,
        string? plane = null,
        string? operation = null,
        long? generation = null,
        string? reason = null,
        long? sequenceOverride = null)
    {
        if (droppedCount <= 0
            || !_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionDiffQueueDropped))
        {
            return;
        }

        Volatile.Read(ref _diffTelemetry)?.QueueDropped(
            stage,
            droppedCount,
            capacity,
            sequenceOverride ?? kept?.Sequence ?? lowestDroppedSequence,
            kept?.Generation ?? generation,
            kept?.Plane ?? plane,
            kept?.Operation ?? operation,
            lowestDroppedSequence,
            highestDroppedSequence,
            reason);
    }

    private void TryPublishPageProjectionDiffFrame(PageProjectionDiff diff)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionDiffFrameReceived))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(diff.Plane) || string.IsNullOrWhiteSpace(diff.Operation))
        {
            return;
        }

        int? sheetCount = null;
        int? ruleCount = null;
        int? seededSheetCount = null;
        if (diff.Install?.Sheets is { Count: > 0 } sheets)
        {
            sheetCount = sheets.Count;
            var rules = 0;
            var seeded = 0;
            foreach (var sheet in sheets)
            {
                rules += sheet.Rules?.Count ?? 0;
                if (sheet.Rules is { Count: > 0 }
                    && sheet.Rules.Exists(r => r.Id.StartsWith("seed:", StringComparison.Ordinal)))
                {
                    seeded++;
                }
            }

            ruleCount = rules;
            seededSheetCount = seeded;
        }
        else if (diff.SheetList?.Added is { Count: > 0 } added)
        {
            sheetCount = added.Count;
            var rules = 0;
            var seeded = 0;
            foreach (var entry in added)
            {
                rules += entry.Sheet?.Rules?.Count ?? 0;
                if (entry.Sheet?.Rules is { Count: > 0 }
                    && entry.Sheet.Rules.Exists(r => r.Id.StartsWith("seed:", StringComparison.Ordinal)))
                {
                    seeded++;
                }
            }

            ruleCount = rules;
            seededSheetCount = seeded;
        }

        Volatile.Read(ref _diffTelemetry)?.FrameReceived(
            diff.Plane.Trim(),
            diff.Operation.Trim(),
            diff.Sequence,
            diff.Generation,
            diff.Timestamp,
            sheetCount,
            ruleCount,
            seededSheetCount);
    }

    /// <summary>
    /// Opt-in VideoStreamingInput path hop. Skips the notification (and therefore Journal) when the
    /// catalog type is disabled — keeps the hot path quiet unless the operator toggles it.
    /// </summary>
    private void TryPublishVideoStreamingInputPathTrace(
        string catalogType,
        string phase,
        string? inputKind,
        string? traceId = null,
        long? clientTimestampMs = null)
    {
        if (string.IsNullOrWhiteSpace(inputKind)
            || !_journalCatalog.IsTypeEnabled(catalogType))
        {
            return;
        }

        TryPublishNotification(new SessionNotification
        {
            Kind = SessionNotificationKind.VideoStreamingInputPathTrace,
            InputKind = inputKind.Trim(),
            Phase = phase,
            TraceId = NullIfEmpty(traceId),
            ClientTimestampMs = clientTimestampMs,
        });
    }

    private void TryPublishVideoStreamingInputApplied(
        string? inputKind,
        string? phase,
        string? traceId,
        long? clientTimestampMs)
    {
        if (string.IsNullOrWhiteSpace(inputKind)
            || !_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.VideoStreamingInputApplied))
        {
            return;
        }

        TryPublishNotification(new SessionNotification
        {
            Kind = SessionNotificationKind.VideoStreamingInputApplied,
            InputKind = inputKind.Trim(),
            Phase = phase,
            TraceId = NullIfEmpty(traceId),
            ClientTimestampMs = clientTimestampMs,
        });
    }

    private void TryPublishVideoStreamingInputRejected(
        string? errorCode,
        string? phase,
        string? message,
        string? traceId,
        long? clientTimestampMs)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.VideoStreamingInputRejected))
        {
            return;
        }

        TryPublishNotification(new SessionNotification
        {
            Kind = SessionNotificationKind.VideoStreamingInputRejected,
            ErrorCode = errorCode,
            Phase = phase,
            Message = message,
            TraceId = NullIfEmpty(traceId),
            ClientTimestampMs = clientTimestampMs,
        });
    }

    private void TryPublishPageProjectionIntentPathTrace(
        string catalogType,
        string phase,
        string? inputKind,
        long? generation,
        string? anchor,
        string? traceId = null,
        long? clientTimestampMs = null,
        string? reason = null)
    {
        if (string.IsNullOrWhiteSpace(inputKind)
            || !_journalCatalog.IsTypeEnabled(catalogType))
        {
            return;
        }

        TryPublishNotification(new SessionNotification
        {
            Kind = SessionNotificationKind.PageProjectionIntentPathTrace,
            InputKind = inputKind.Trim(),
            Phase = phase,
            DomGeneration = generation,
            DomAnchor = anchor,
            TraceId = NullIfEmpty(traceId),
            ClientTimestampMs = clientTimestampMs,
            Reason = NullIfEmpty(reason),
        });
    }

    private void TryPublishPageProjectionIntentApplied(
        string? inputKind,
        string? phase,
        long? generation,
        string? anchor,
        string? traceId,
        long? clientTimestampMs)
    {
        if (string.IsNullOrWhiteSpace(inputKind)
            || !_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionIntentApplied))
        {
            return;
        }

        TryPublishNotification(new SessionNotification
        {
            Kind = SessionNotificationKind.PageProjectionIntentApplied,
            InputKind = inputKind.Trim(),
            Phase = phase,
            DomGeneration = generation,
            DomAnchor = anchor,
            TraceId = NullIfEmpty(traceId),
            ClientTimestampMs = clientTimestampMs,
        });
    }

    private void TryPublishPageProjectionIntentRejected(
        string? errorCode,
        string? phase,
        string? message,
        long? generation,
        string? anchor,
        string? traceId,
        long? clientTimestampMs)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionIntentRejected))
        {
            return;
        }

        TryPublishNotification(new SessionNotification
        {
            Kind = SessionNotificationKind.PageProjectionIntentRejected,
            ErrorCode = errorCode,
            Phase = phase,
            Message = message,
            DomGeneration = generation,
            DomAnchor = anchor,
            TraceId = NullIfEmpty(traceId),
            ClientTimestampMs = clientTimestampMs,
        });
    }

    private static long? DomClientTimestampMs(double? timestampClient)
        => timestampClient is { } value ? (long)Math.Round(value) : null;

    private static string? NullIfEmpty(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

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
