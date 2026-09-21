using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text.Json;
using System.Threading.Channels;
using Aidan.Core.Patterns;
using Microsoft.Extensions.Logging;
using Speculum.Api.BrowserClients.Grpc;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Configurations.Models.Sidecar;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Streaming;
using Speculum.Api.Telemetry;
using Speculum.Supervisor.Control;
using Speculum.Supervisor.Wire;

namespace Speculum.Api.BrowserClients.Gecko;

/// <summary>
/// Ligação Live ↔ orquestrador. Frames Kind 0x01, intent ABI, resize ViewportSet, ativo 0x06.
/// </summary>
public sealed class GeckoSessionConnection : ISessionConnection, IDisposable
{
    private const int ReceiveChunkBytes = 64 * 1024;

    private readonly IHttpClientFactory _httpFactory;
    private readonly SidecarOptions _options;
    private readonly IConfigurationService _configuration;
    private readonly IJournalCatalog _journalCatalog;
    private readonly ILogger _logger;
    private readonly Action<Guid> _onClosed;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly object _gate = new();
    private readonly Channel<Frame> _frames = Channel.CreateBounded<Frame>(
        new BoundedChannelOptions(2) { FullMode = BoundedChannelFullMode.DropOldest });
    private readonly Channel<PageProjectionFrame> _domDiffs;
    private readonly Channel<ConsoleOutput> _console = Channel.CreateBounded<ConsoleOutput>(
        new BoundedChannelOptions(8) { FullMode = BoundedChannelFullMode.DropOldest });
    private readonly Channel<SessionNotification> _notifications = Channel.CreateBounded<SessionNotification>(
        new BoundedChannelOptions(32) { FullMode = BoundedChannelFullMode.DropOldest });
    private readonly ConcurrentDictionary<uint, AssetWaiter> _assets = new();
    private readonly SemaphoreSlim _sendGate = new(1, 1);

    private ClientWebSocket? _socket;
    private Task? _pump;
    private uint _correlation = 1;
    private uint _assetStream = 1;
    private int _open = 1;
    private int _allocated;
    private int _width = 1280;
    private int _height = 800;
    private string _url = "about:blank";
    private Func<CancellationToken, Task<PermissionDecision>> _camera =
        static _ => Task.FromResult(PermissionDecision.Deny);
    private Func<CancellationToken, Task<PermissionDecision>> _microphone =
        static _ => Task.FromResult(PermissionDecision.Deny);
    private IPageProjectionFrameTelemetry? _diffTelemetry;
    private long _oldestConnectionFrameEnqueueMs;
    private TaskCompletionSource? _contextCreated;
    private readonly long _startedMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public GeckoSessionConnection(
        Guid sessionId,
        IHttpClientFactory httpFactory,
        SidecarOptions options,
        IConfigurationService configuration,
        IJournalCatalog journalCatalog,
        ILogger logger,
        Action<Guid> onClosed)
    {
        SessionId = sessionId;
        _httpFactory = httpFactory;
        _options = options;
        _configuration = configuration;
        _journalCatalog = journalCatalog;
        _logger = logger;
        _onClosed = onClosed;
        _domDiffs = PageProjectionFrameChannels.CreateConnectionQueue<PageProjectionFrame>(
            GrpcSessionMappers.ClampFrameQueueCapacity(configuration.GetCurrent().Sessions.FrameQueueCapacity));
    }

    public Guid SessionId { get; }

    public bool IsOpen => Volatile.Read(ref _open) == 1;

    public Task<IResult<SessionStatus>> GetStatusAsync(CancellationToken ct = default)
    {
        if (!IsOpen)
        {
            return Task.FromResult<IResult<SessionStatus>>(Result<SessionStatus>.Failure("Connection closed"));
        }

        return Task.FromResult<IResult<SessionStatus>>(Result<SessionStatus>.Success(new SessionStatus
        {
            TabCount = 1,
            Url = _url,
            Width = _width,
            Height = _height,
            DisplayWidth = _width,
            DisplayHeight = _height,
            ChromeWidth = _width,
            ChromeHeight = _height,
            SessionId = SessionId.ToString("D"),
            UptimeMs = Math.Max(0, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - _startedMs),
        }));
    }

    public async Task<IResult> CloseAsync(CancellationToken ct = default)
    {
        if (Interlocked.Exchange(ref _open, 0) == 0)
        {
            return Result.Success();
        }

        try
        {
            await StopPairAsync(ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Gecko close {SessionId} kill failed", SessionId);
        }

        _lifetime.Cancel();
        try { _socket?.Abort(); } catch (ObjectDisposedException) { }
        _domDiffs.Writer.TryComplete();
        _frames.Writer.TryComplete();
        _console.Writer.TryComplete();
        _notifications.Writer.TryComplete();
        _onClosed(SessionId);
        _lifetime.Dispose();
        _sendGate.Dispose();
        return Result.Success();
    }

    public void Dispose() => CloseAsync(CancellationToken.None).GetAwaiter().GetResult();

    public async Task<IResult<BrowserReadyInfo>> LaunchBrowserAsync(
        SessionConfig? configuration,
        string requestHost,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(requestHost))
        {
            return Result<BrowserReadyInfo>.Failure("Request host is required");
        }

        var sessions = _configuration.GetCurrent().Sessions;
        if (sessions.MirrorMode == MirrorMode.VideoStreaming)
        {
            return Result<BrowserReadyInfo>.Failure(
                "video_streaming_unsupported|launch|Gecko Live is PageProjection only");
        }

        if (configuration?.CpuProfiling == true)
        {
            return Result<BrowserReadyInfo>.Failure(
                "gecko_cpu_profile_unsupported|launch|Gecko has no Chromium CPU profile ABI");
        }

        var validated = GrpcRequestValidation.ValidateLaunch(configuration, sessions.ViewportPolicy);
        if (validated.IsFailure)
        {
            return Result<BrowserReadyInfo>.Failure(validated.Errors.ToArray());
        }

        var (width, height) = validated.Value;
        _width = width;
        _height = height;

        try
        {
            await AllocateAsync(width, height, ct).ConfigureAwait(false);
            await ConnectWsAsync(ct).ConfigureAwait(false);
            await WaitContextCreatedAsync(ct).ConfigureAwait(false);
            return Result<BrowserReadyInfo>.Success(new BrowserReadyInfo { Width = width, Height = height });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Gecko launch failed for {SessionId}", SessionId);
            return Result<BrowserReadyInfo>.Failure($"gecko_launch_failed|launch|{ex.Message}");
        }
    }

    public async Task<IResult> StopBrowserAsync(CancellationToken ct = default)
    {
        try
        {
            await StopPairAsync(ct).ConfigureAwait(false);
            return Result.Success();
        }
        catch (Exception ex)
        {
            return Result.Failure($"gecko_stop_failed|stop|{ex.Message}");
        }
    }

    public Task<IResult<SessionState>> ExportSessionStateAsync(CancellationToken ct = default)
        => Task.FromResult<IResult<SessionState>>(Result<SessionState>.Success(new SessionState()));

    public Task<IResult<CookieNormalizeStats>> RestoreProfileStateAsync(
        ProfileState state,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(state);
        // Chromium jar on the persisted profile is not a Gecko ABI. Do not abort
        // Live — start with an empty Gecko profile. Cookies are not applied.
        if (state.Cookies.Count > 0
            || state.LocalStorage.Count > 0
            || state.IdbRecords.Count > 0
            || state.History.Count > 0)
        {
            _logger.LogWarning(
                "Gecko cannot apply Chromium profile state (cookies={Cookies}, localStorage={LocalStorage}, idb={Idb}, history={History}) — empty jar",
                state.Cookies.Count,
                state.LocalStorage.Count,
                state.IdbRecords.Count,
                state.History.Count);
        }

        return Task.FromResult<IResult<CookieNormalizeStats>>(
            Result<CookieNormalizeStats>.Success(CookieNormalizeStats.Empty));
    }

    public async Task<IResult> NavigateAsync(string url, CancellationToken ct = default)
    {
        var validated = GrpcRequestValidation.ValidateNavigate(url);
        if (validated.IsFailure)
        {
            return Result.Failure(validated.Errors.ToArray());
        }

        if (!await SendCommandAsync(ControlCommand.Navigate(NextCorr(), 0, url), ct).ConfigureAwait(false))
        {
            return Result.Failure("gecko_navigate_failed|navigate|supervisor not connected");
        }

        _url = url;
        return Result.Success();
    }

    public Task<IResult> NavigateClientAsync(string path, string query, CancellationToken ct = default)
        => Task.FromResult<IResult>(
            Result.Failure("gecko_navigate_client_unsupported|navigate|Gecko has no sidecar NavigationPolicy path"));

    public async Task<IResult> RefreshAsync(CancellationToken ct = default)
    {
        if (!await SendCommandAsync(ControlCommand.Reload(NextCorr(), 0), ct).ConfigureAwait(false))
        {
            return Result.Failure("gecko_refresh_failed|refresh|supervisor not connected");
        }

        return Result.Success();
    }

    public async Task<IResult<ResizeResult>> ResizeAsync(
        string requestId,
        int width,
        int height,
        DeviceProfile device,
        CancellationToken ct = default)
    {
        var policy = _configuration.GetCurrent().Sessions.ViewportPolicy;
        var validated = GrpcRequestValidation.ValidateResize(width, height, policy);
        if (validated.IsFailure)
        {
            var first = validated.Errors.FirstOrDefault();
            return Result<ResizeResult>.Success(new ResizeResult
            {
                Applied = false,
                Outcome = ResizeOutcome.Rejected,
                Width = width,
                Height = height,
                DisplayWidth = policy.Maximum.Width,
                DisplayHeight = policy.Maximum.Height,
                ResizeId = requestId,
                ErrorCode = string.IsNullOrWhiteSpace(first?.Code) ? "invalid_viewport" : first.Code,
                Phase = "validate",
                Message = first?.Message ?? string.Join("; ", validated.Errors.Select(e => e.Message)),
            });
        }

        if (!await SendCommandAsync(ControlCommand.ViewportSet(NextCorr(), 0, width, height), ct)
                .ConfigureAwait(false))
        {
            return Result<ResizeResult>.Success(new ResizeResult
            {
                Applied = false,
                Outcome = ResizeOutcome.Failed,
                Width = width,
                Height = height,
                ResizeId = requestId,
                ErrorCode = "gecko_resize_failed",
                Phase = "viewport",
                Message = "supervisor not connected",
            });
        }

        _width = width;
        _height = height;
        return Result<ResizeResult>.Success(new ResizeResult
        {
            Applied = true,
            Outcome = ResizeOutcome.Applied,
            Width = width,
            Height = height,
            DisplayWidth = width,
            DisplayHeight = height,
            ChromeWidth = width,
            ChromeHeight = height,
            ResizeId = requestId,
        });
    }

    public Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
        DiagProbeRequest request,
        CancellationToken ct = default)
        => Task.FromResult<IResult<DiagProbeResult>>(Result<DiagProbeResult>.Success(new DiagProbeResult
        {
            Ok = false,
            ErrorCode = "diag_probe_unsupported",
            Message = "Gecko has no Patchright diagProbe. phase=probe",
        }));

    public IResult<ChannelReader<Frame>> GetFrameReader()
        => Result<ChannelReader<Frame>>.Success(_frames.Reader);

    public IResult<ChannelReader<PageProjectionFrame>> GetPageProjectionFrameReader()
        => Result<ChannelReader<PageProjectionFrame>>.Success(_domDiffs.Reader);

    public IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputReader()
        => Result<ChannelReader<ConsoleOutput>>.Success(_console.Reader);

    public IResult<ChannelReader<SessionNotification>> GetNotificationReader()
        => Result<ChannelReader<SessionNotification>>.Success(_notifications.Reader);

    public void SetCameraPermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler)
        => _camera = handler;

    public void SetMicrophonePermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler)
        => _microphone = handler;

    public IResult<Task> ConsumeVideoStreamingInputAsync(ChannelReader<VideoStreamingInput> channelReader)
        => Result<Task>.Failure("video_streaming_unsupported|input|Gecko Live is PageProjection only");

    public IResult<Task> ConsumePageProjectionIntentAsync(ChannelReader<PageProjectionIntent> channelReader)
    {
        if (!IsOpen)
        {
            return Result<Task>.Failure("Connection closed");
        }

        return Result<Task>.Success(PumpIntentAsync(channelReader, _lifetime.Token));
    }

    public Task<IResult<VirtualResourceResponse>> GetVirtualAssetAsync(
        string key,
        CancellationToken ct = default,
        string? kind = null,
        string? rangeHeader = null)
        => Task.FromResult<IResult<VirtualResourceResponse>>(
            Result<VirtualResourceResponse>.Failure(
                "gecko_virtual_asset_unsupported|fetch|Gecko Live uses original URLs + Kind 0x06, not Chromium virtual-assets"));

    public async Task<IResult<VirtualResourceResponse>> FetchProjectedAssetAsync(
        uint contextId,
        string url,
        string destination,
        string range,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            return Result<VirtualResourceResponse>.Failure("Asset URL is required");
        }

        var streamId = Interlocked.Increment(ref _assetStream);
        var tcs = new TaskCompletionSource<VirtualResourceResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
        var waiter = new AssetWaiter(tcs);
        _assets[streamId] = waiter;

        var envelope = GeckoAssetWire.EncodeRequest(
            streamId,
            GeckoAssetWire.ClassifyDestination(destination),
            url,
            range ?? "");
        GeckoAssetWire.StampContext(envelope, contextId == 0 ? 1 : contextId);

        if (!await SendRawAsync(envelope, ct).ConfigureAwait(false))
        {
            _assets.TryRemove(streamId, out _);
            return Result<VirtualResourceResponse>.Failure("gecko_asset_failed|fetch|supervisor not connected");
        }

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, _lifetime.Token);
        linked.CancelAfter(TimeSpan.FromSeconds(20));
        try
        {
            var result = await tcs.Task.WaitAsync(linked.Token).ConfigureAwait(false);
            return Result<VirtualResourceResponse>.Success(result);
        }
        catch (OperationCanceledException)
        {
            _assets.TryRemove(streamId, out _);
            return Result<VirtualResourceResponse>.Failure("gecko_asset_timeout|fetch|asset response timed out");
        }
    }

    public async Task<IResult> RequestResyncAsync(
        uint contextId = 1,
        string? reason = null,
        CancellationToken ct = default)
    {
        var force = (byte)(string.Equals(reason, "wire_stall", StringComparison.Ordinal) ? 1 : 0);
        if (!await SendCommandAsync(ControlCommand.Resync(NextCorr(), contextId, force), ct).ConfigureAwait(false))
        {
            return Result.Failure("gecko_resync_failed|resync|supervisor not connected");
        }

        return Result.Success();
    }

    public Task<IResult> PutDomUploadAsync(
        string uploadId,
        byte[] body,
        string contentType,
        string name,
        CancellationToken ct = default)
        => Task.FromResult<IResult>(
            Result.Failure("gecko_set_files_unsupported|upload|Gecko has no setFiles ABI"));

    public IResult<Task> ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader)
        => Result<Task>.Failure("gecko_console_unsupported|console|Gecko has no console relay");

    public void BindPageProjectionFrameTelemetry(IPageProjectionFrameTelemetry? telemetry)
        => Volatile.Write(ref _diffTelemetry, telemetry);

    public bool IsPageProjectionFrameFanOutEnqueuedEnabled()
        => _journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionFrameFanOutEnqueued);

    public void ReportPageProjectionFrameFanOutEnqueued(
        PageProjectionFrame diff,
        long waitMs,
        Guid streamId,
        Guid consumerId,
        string kind,
        int targetIndex,
        int targetCount,
        int frameChannelCount,
        long frameEpoch)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionFrameFanOutEnqueued)
            || string.IsNullOrWhiteSpace(kind))
        {
            return;
        }

        Volatile.Read(ref _diffTelemetry)?.FanOutEnqueued(
            diff.Plane ?? "",
            diff.Operation ?? "",
            diff.Sequence,
            diff.Generation,
            diff.Timestamp,
            waitMs,
            streamId,
            consumerId,
            kind.Trim(),
            targetIndex,
            targetCount,
            frameChannelCount,
            frameEpoch);
    }

    public void ReportPageProjectionFrameOutputStreamOpened(
        Guid streamId, Guid consumerId, string kind, int openStreamCount, int frameChannelCapacity)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionFrameOutputStreamOpened)
            || string.IsNullOrWhiteSpace(kind))
        {
            return;
        }

        Volatile.Read(ref _diffTelemetry)?.OutputStreamOpened(
            streamId, consumerId, kind.Trim(), openStreamCount, frameChannelCapacity);
    }

    public void ReportPageProjectionFrameOutputStreamClosed(
        Guid streamId, Guid consumerId, string kind, int openStreamCount)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionFrameOutputStreamClosed)
            || string.IsNullOrWhiteSpace(kind))
        {
            return;
        }

        Volatile.Read(ref _diffTelemetry)?.OutputStreamClosed(streamId, consumerId, kind.Trim(), openStreamCount);
    }

    public void ReportPageProjectionFrameQueueDropped(
        string stage,
        int droppedCount,
        int capacity,
        long? sequence = null,
        long? generation = null,
        string? plane = null,
        string? operation = null,
        long? lowestDroppedSequence = null,
        long? highestDroppedSequence = null,
        string? reason = null,
        Guid? streamId = null,
        Guid? consumerId = null,
        string? kind = null,
        int? targetCount = null,
        int? frameChannelCount = null,
        long? frameEpoch = null)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionFrameQueueDropped))
        {
            return;
        }

        Volatile.Read(ref _diffTelemetry)?.QueueDropped(
            stage,
            droppedCount,
            capacity,
            sequence,
            generation,
            plane,
            operation,
            lowestDroppedSequence,
            highestDroppedSequence,
            reason,
            streamId,
            consumerId,
            kind,
            targetCount,
            frameChannelCount,
            frameEpoch);
    }

    public int GetPageProjectionFrameConnectionQueueDepth()
        => _domDiffs.Reader.CanCount ? _domDiffs.Reader.Count : 0;

    public ulong GetPageProjectionFrameConnectionQueuedBytes() => 0;

    public ulong GetPageProjectionFrameOldestQueuedMs()
    {
        var enqueueMs = Volatile.Read(ref _oldestConnectionFrameEnqueueMs);
        if (enqueueMs <= 0)
        {
            return 0;
        }

        var age = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - enqueueMs;
        return age > 0 ? (ulong)age : 0;
    }

    public void NotifyPageProjectionFrameConnectionDequeued()
    {
        if (_domDiffs.Reader.CanCount && _domDiffs.Reader.Count == 0)
        {
            Volatile.Write(ref _oldestConnectionFrameEnqueueMs, 0);
        }
    }

    public void TrySendConsumerPressure(ConsumerPressureSnapshot snapshot)
    {
        // Gecko supervisor does not take Chromium consumer-pressure RPC.
    }

    private async Task AllocateAsync(int width, int height, CancellationToken ct)
    {
        var client = _httpFactory.CreateClient(GeckoBrowserClient.HttpClientName);
        using var response = await client.PostAsJsonAsync(
                "sessions",
                new { sessionId = SessionId.ToString("D"), width, height },
                ct)
            .ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            throw new InvalidOperationException($"orchestrator allocate {(int)response.StatusCode}: {body}");
        }

        Interlocked.Exchange(ref _allocated, 1);
    }

    private async Task ConnectWsAsync(CancellationToken ct)
    {
        var baseUri = new Uri(_options.OrchestratorAddress.TrimEnd('/') + "/");
        var wsUri = new UriBuilder(baseUri)
        {
            Scheme = baseUri.Scheme == "https" ? "wss" : "ws",
            Path = baseUri.AbsolutePath.TrimEnd('/') + $"/sessions/{SessionId:D}",
        }.Uri;

        var socket = new ClientWebSocket();
        await socket.ConnectAsync(wsUri, ct).ConfigureAwait(false);
        _socket = socket;
        _contextCreated = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _pump = PumpAsync(_lifetime.Token);
    }

    private async Task WaitContextCreatedAsync(CancellationToken ct)
    {
        var ready = _contextCreated;
        if (ready is null)
        {
            return;
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(25));
        await ready.Task.WaitAsync(timeout.Token).ConfigureAwait(false);
    }

    private async Task PumpAsync(CancellationToken ct)
    {
        var socket = _socket;
        if (socket is null)
        {
            return;
        }

        var buffer = new byte[ReceiveChunkBytes];
        using var assembled = new MemoryStream();
        try
        {
            while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                assembled.SetLength(0);
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(buffer, ct).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        PublishCrash("gecko_bridge_closed", "pump", "orchestrator closed the session socket");
                        return;
                    }

                    assembled.Write(buffer, 0, result.Count);
                }
                while (!result.EndOfMessage);

                if (result.MessageType != WebSocketMessageType.Binary || assembled.Length == 0)
                {
                    continue;
                }

                Dispatch(assembled.ToArray());
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (WebSocketException ex)
        {
            PublishCrash("gecko_bridge_down", "pump", ex.Message);
        }
    }

    private void Dispatch(byte[] frame)
    {
        // Mesmo contrato do Lab (SupervisorClient): Asset / Event / Telemetry envelopados;
        // frame PP chega cru do BrowserLink.Broadcast — não exigir Kind 0x01 no fio do consumidor.
        if (!GeckoConsumerWire.TryClassify(frame, out var kind, out var contextId, out var payload))
        {
            return;
        }

        switch (kind)
        {
            case GeckoConsumerWire.Kind.Asset:
                OnAsset(payload.AsSpan());
                return;
            case GeckoConsumerWire.Kind.BrowserEvent:
                OnEvent(payload.ToArray());
                return;
            case GeckoConsumerWire.Kind.Telemetry:
                return;
            case GeckoConsumerWire.Kind.ProjectionFrame:
                break;
            default:
                return;
        }

        var body = payload.Count == payload.Array!.Length && payload.Offset == 0
            ? payload.Array
            : payload.ToArray();
        if (GeckoFramePeek.ToFrame(body, contextId) is not { } diff)
        {
            return;
        }

        if (Volatile.Read(ref _oldestConnectionFrameEnqueueMs) == 0)
        {
            Volatile.Write(ref _oldestConnectionFrameEnqueueMs, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        }

        _domDiffs.Writer.TryWrite(diff);
    }

    private void OnEvent(byte[] payload)
    {
        BrowserEvent ev;
        try
        {
            ev = BrowserEvent.Decode(payload);
        }
        catch (InvalidDataException ex)
        {
            _logger.LogWarning(ex, "Gecko event ilegível {SessionId}", SessionId);
            return;
        }

        switch (ev.OpCode)
        {
            case ControlOpCode.ContextCreated:
                _contextCreated?.TrySetResult();
                break;
            case ControlOpCode.Navigated:
                if (!string.IsNullOrWhiteSpace(ev.Text))
                {
                    _url = ev.Text;
                    _notifications.Writer.TryWrite(new SessionNotification
                    {
                        Kind = SessionNotificationKind.LocationChanged,
                        Url = ev.Text,
                    });
                }

                _contextCreated?.TrySetResult();
                break;
            case ControlOpCode.Fault:
                PublishCrash("gecko_fault", "browser", ev.Text ?? "fault");
                break;
            case ControlOpCode.PermissionRequested:
                _ = AnswerPermissionAsync(ev);
                break;
            case ControlOpCode.DialogRequested:
            case ControlOpCode.DownloadRequested:
                _ = SendCommandAsync(
                    ev.OpCode == ControlOpCode.DownloadRequested
                        ? ControlCommand.DownloadRespond(NextCorr(), ev.ContextId, (uint)ev.BrowsingContextId, false)
                        : ControlCommand.DialogRespond(NextCorr(), ev.ContextId, (uint)ev.BrowsingContextId, ReadOnlySpan<byte>.Empty),
                    _lifetime.Token);
                break;
        }
    }

    private async Task AnswerPermissionAsync(BrowserEvent ev)
    {
        var text = ev.Text ?? "";
        var handler = text.Contains("microphone", StringComparison.OrdinalIgnoreCase)
            ? _microphone
            : _camera;
        var granted = false;
        try
        {
            granted = await handler(_lifetime.Token).ConfigureAwait(false) == PermissionDecision.Allow;
        }
        catch
        {
            granted = false;
        }

        await SendCommandAsync(
                ControlCommand.PermissionRespond(NextCorr(), ev.ContextId, (uint)ev.BrowsingContextId, granted),
                _lifetime.Token)
            .ConfigureAwait(false);
    }

    private void OnAsset(ReadOnlySpan<byte> payload)
    {
        var decoded = GeckoAssetWire.DecodeBody(payload);
        if (decoded is null)
        {
            return;
        }

        var (streamId, phase, data) = decoded.Value;
        if (!_assets.TryGetValue(streamId, out var waiter))
        {
            return;
        }

        if (phase == 1 && data.Length > 0)
        {
            waiter.Chunks.Add(data);
            return;
        }

        if (phase == 2)
        {
            _assets.TryRemove(streamId, out _);
            waiter.Completion.TrySetException(new InvalidOperationException(
                EncodingUtf8(data) is { Length: > 0 } why ? why : "denied"));
            return;
        }

        if (phase == 3)
        {
            _assets.TryRemove(streamId, out _);
            var total = waiter.Chunks.Sum(c => c.Length);
            var body = new byte[total];
            var o = 0;
            foreach (var chunk in waiter.Chunks)
            {
                Buffer.BlockCopy(chunk, 0, body, o, chunk.Length);
                o += chunk.Length;
            }

            waiter.Completion.TrySetResult(new VirtualResourceResponse
            {
                Body = body,
                ContentType = EncodingUtf8(data),
                StatusCode = 200,
            });
        }
    }

    private async Task PumpIntentAsync(ChannelReader<PageProjectionIntent> reader, CancellationToken ct)
    {
        await foreach (var intent in reader.ReadAllAsync(ct).ConfigureAwait(false))
        {
            var stamped = intent.WithAdmissionNormalization();
            if (string.Equals(stamped.Type, "click", StringComparison.OrdinalIgnoreCase)
                || string.Equals(stamped.Type, "auxclick", StringComparison.OrdinalIgnoreCase))
            {
                PublishIntentRejected("input_invalid", "validate", $"Invalid dom input: {stamped.Type}", stamped);
                continue;
            }

            byte[]? command;
            try
            {
                command = GeckoIntentEncoder.Encode(NextCorr(), stamped);
            }
            catch (JsonException)
            {
                PublishIntentRejected("input_invalid", "validate", "payload JSON", stamped);
                continue;
            }

            if (command is null)
            {
                continue;
            }

            if (!await SendRawAsync(command, ct).ConfigureAwait(false))
            {
                PublishIntentRejected("input_push_failed", "push", "supervisor not connected", stamped);
                continue;
            }

            PublishIntentApplied(stamped);
        }
    }

    private void PublishIntentApplied(PageProjectionIntent intent)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionIntentApplied))
        {
            return;
        }

        _notifications.Writer.TryWrite(new SessionNotification
        {
            Kind = SessionNotificationKind.PageProjectionIntentApplied,
            InputKind = intent.Type,
            Phase = "push",
            DomGeneration = intent.Generation,
            DomAnchor = intent.Anchor,
            TraceId = intent.TraceId,
            ClientTimestampMs = intent.TimestampClient is { } t ? (long)Math.Round(t) : null,
        });
    }

    private void PublishIntentRejected(string code, string phase, string message, PageProjectionIntent intent)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionIntentRejected))
        {
            return;
        }

        _notifications.Writer.TryWrite(new SessionNotification
        {
            Kind = SessionNotificationKind.PageProjectionIntentRejected,
            ErrorCode = code,
            Phase = phase,
            Message = message,
            DomGeneration = intent.Generation,
            DomAnchor = intent.Anchor,
            TraceId = intent.TraceId,
        });
    }

    private void PublishCrash(string errorCode, string phase, string message)
    {
        _notifications.Writer.TryWrite(new SessionNotification
        {
            Kind = SessionNotificationKind.Crashed,
            ErrorCode = errorCode,
            Phase = phase,
            Message = message,
        });
    }

    private async Task<bool> SendCommandAsync(byte[] command, CancellationToken ct)
        => await SendRawAsync(command, ct).ConfigureAwait(false);

    private async Task<bool> SendRawAsync(byte[] payload, CancellationToken ct)
    {
        var socket = _socket;
        if (socket is null || socket.State != WebSocketState.Open || !IsOpen)
        {
            return false;
        }

        await _sendGate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            await socket.SendAsync(payload, WebSocketMessageType.Binary, endOfMessage: true, ct)
                .ConfigureAwait(false);
            return true;
        }
        catch (Exception ex) when (ex is WebSocketException or ObjectDisposedException)
        {
            return false;
        }
        finally
        {
            _sendGate.Release();
        }
    }

    private async Task StopPairAsync(CancellationToken ct)
    {
        if (Interlocked.Exchange(ref _allocated, 0) == 0)
        {
            return;
        }

        var client = _httpFactory.CreateClient(GeckoBrowserClient.HttpClientName);
        using var response = await client.DeleteAsync($"sessions/{SessionId:D}", ct).ConfigureAwait(false);
        _ = response;
    }

    private uint NextCorr() => Interlocked.Increment(ref _correlation);

    private static string EncodingUtf8(byte[] data)
        => data.Length == 0 ? "" : System.Text.Encoding.UTF8.GetString(data);

    private sealed class AssetWaiter(TaskCompletionSource<VirtualResourceResponse> completion)
    {
        public TaskCompletionSource<VirtualResourceResponse> Completion { get; } = completion;

        public List<byte[]> Chunks { get; } = [];
    }
}
