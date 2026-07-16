using System.Buffers;
using System.Buffers.Binary;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Motor.Sidecar;

internal static class SidecarProtocol
{
    public const byte MsgSkip       = 0x03;
    public const byte MsgUrl        = SidecarWireProtocol.MsgUrl;
    public const byte MsgConsole    = SidecarWireProtocol.MsgConsole;
    public const byte MsgEvalResult = SidecarWireProtocol.MsgEvalResult;
    public const byte MsgH264       = SidecarWireProtocol.MsgH264;
    public const byte MsgScreencast = SidecarWireProtocol.MsgScreencast;
    public const byte MsgStatus     = SidecarWireProtocol.MsgStatus;
    public const byte MsgRedirect   = SidecarWireProtocol.MsgRedirect;
}

public sealed class SidecarClient : ISidecarClient
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private readonly ClientWebSocket               _ws       = new();
    private readonly CancellationTokenSource       _cts      = new();
    private readonly Channel<ReadOnlyMemory<byte>> _video;
    private readonly Channel<ReadOnlyMemory<byte>> _control;
    private readonly SemaphoreSlim                 _sendLock = new(1, 1);

    private Task? _receiveTask;
    private TaskCompletionSource<BrowserStatePayload>? _stateExportTcs;
    private TaskCompletionSource<object>? _diagProbeTcs;
    private string? _diagProbeRequestId;

    public string SessionId { get; }

    public ChannelReader<ReadOnlyMemory<byte>> VideoChannel   => _video.Reader;
    public ChannelReader<ReadOnlyMemory<byte>> ControlChannel => _control.Reader;

    public SidecarClient(string sessionId)
    {
        SessionId = sessionId;

        _video = Channel.CreateBounded<ReadOnlyMemory<byte>>(new BoundedChannelOptions(2)
        {
            FullMode     = BoundedChannelFullMode.DropOldest,
            SingleWriter = true,
            SingleReader = true,
        });

        _control = Channel.CreateUnbounded<ReadOnlyMemory<byte>>(new UnboundedChannelOptions
        {
            SingleWriter = true,
            SingleReader = true,
        });
    }

    public async Task ConnectAsync(
        string                        sidecarBaseUrl,
        int                           width,
        int                           height,
        string?                       initialUrl               = null,
        BrowserStatePayload?          browserState             = null,
        IReadOnlyList<ScriptPayload>? scripts                  = null,
        bool                          jsBridgeEnabled          = false,
        IReadOnlyList<string>?        allowedNavigationDomains = null,
        Speculum.Api.Motor.Live.DeviceProfile? device          = null,
        CancellationToken             ct                       = default)
    {
        var uri = new Uri(sidecarBaseUrl.TrimEnd('/'));
        await _ws.ConnectAsync(uri, ct);

        var scriptDtos = (scripts ?? [])
            .Select(s => new { position = s.Position, type = s.Type, file = s.File, content = s.Content })
            .ToArray();

        var createPayload = new Dictionary<string, object?>
        {
            ["type"]                     = "create",
            ["sessionId"]                = SessionId,
            ["width"]                    = width,
            ["height"]                   = height,
            ["url"]                      = initialUrl,
            ["scripts"]                  = scriptDtos,
            ["jsBridgeEnabled"]          = jsBridgeEnabled,
            ["allowedNavigationDomains"] = allowedNavigationDomains,
        };

        if (device is not null)
        {
            createPayload["mobile"] = device.Mobile;
            createPayload["touch"] = device.Touch;
            createPayload["deviceScaleFactor"] = device.DeviceScaleFactor;
            createPayload["maxTouchPoints"] = device.MaxTouchPoints;
            createPayload["userAgentProfile"] = device.UserAgentProfile;
            createPayload["screenOrientation"] = device.ScreenOrientation;
        }

        if (browserState is not null)
            createPayload["browserState"] = browserState;

        var createBytes = JsonSerializer.SerializeToUtf8Bytes(createPayload, JsonOptions);
        await SendCoreAsync(createBytes, ct);

        var preReadyFrames = await WaitForReadyAsync(ct);
        _receiveTask = ReceiveLoopAsync(_cts.Token, preReadyFrames);
    }

    public async Task<BrowserStatePayload> RequestStateExportAsync(CancellationToken ct = default)
    {
        if (_ws.State != WebSocketState.Open)
            throw new InvalidOperationException("Sidecar WebSocket is not open.");

        _stateExportTcs = new TaskCompletionSource<BrowserStatePayload>(
            TaskCreationOptions.RunContinuationsAsynchronously);

        var request = JsonSerializer.SerializeToUtf8Bytes(new { type = "exportState" });
        await SendCoreAsync(request, ct);

        return await _stateExportTcs.Task.WaitAsync(ct);
    }

    public async Task<object> RequestDiagnosticsAsync(
        IReadOnlyList<string> ops,
        string? evaluateExpression = null,
        string? domSelector = null,
        int? maxProbeResponseBytes = null,
        CancellationToken ct = default)
    {
        if (_ws.State != WebSocketState.Open)
            throw new InvalidOperationException("Sidecar WebSocket is not open.");

        var requestId = Guid.NewGuid().ToString("N");
        _diagProbeRequestId = requestId;
        _diagProbeTcs = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);

        var payload = new Dictionary<string, object?>
        {
            ["type"] = "diagProbe",
            ["requestId"] = requestId,
            ["ops"] = ops,
        };
        if (!string.IsNullOrWhiteSpace(evaluateExpression))
            payload["evaluateExpression"] = evaluateExpression;
        if (!string.IsNullOrWhiteSpace(domSelector))
            payload["domSelector"] = domSelector;
        if (maxProbeResponseBytes is > 0)
            payload["maxProbeResponseBytes"] = maxProbeResponseBytes.Value;

        var request = JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions);
        await SendCoreAsync(request, ct);

        return await _diagProbeTcs.Task.WaitAsync(ct);
    }

    private async Task<List<byte[]>> WaitForReadyAsync(CancellationToken ct)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(30));
        var timeoutCt = timeoutCts.Token;

        var buf          = new byte[64 * 1024];
        int filled       = 0;
        var preReady     = new List<byte[]>();
        int binaryFilled = 0;
        var binaryBuf    = new byte[256 * 1024];

        while (true)
        {
            if (filled == buf.Length) Array.Resize(ref buf, buf.Length * 2);

            ValueWebSocketReceiveResult result;
            try
            {
                result = await _ws.ReceiveAsync(buf.AsMemory(filled), timeoutCt);
            }
            catch (OperationCanceledException) when (
                timeoutCts.IsCancellationRequested && !ct.IsCancellationRequested)
            {
                throw new TimeoutException(
                    $"Sidecar did not become ready within 30 s (session {SessionId}).");
            }

            if (result.MessageType == WebSocketMessageType.Close)
                throw new InvalidOperationException(
                    $"Sidecar closed connection before reporting ready (session {SessionId}).");

            if (result.MessageType == WebSocketMessageType.Binary)
            {
                if (binaryFilled + result.Count > binaryBuf.Length)
                    Array.Resize(ref binaryBuf, Math.Max(binaryBuf.Length * 2, binaryFilled + result.Count));

                Buffer.BlockCopy(buf, 0, binaryBuf, binaryFilled, result.Count);
                binaryFilled += result.Count;

                if (result.EndOfMessage)
                {
                    var frame = new byte[binaryFilled];
                    Buffer.BlockCopy(binaryBuf, 0, frame, 0, binaryFilled);
                    preReady.Add(frame);
                    binaryFilled = 0;
                }

                filled = 0;
                continue;
            }

            filled += result.Count;
            if (!result.EndOfMessage) continue;

            var text = Encoding.UTF8.GetString(buf, 0, filled);
            filled = 0;

            try
            {
                using var doc = JsonDocument.Parse(text);
                var type = doc.RootElement.GetProperty("type").GetString();
                if (type == "ready") return preReady;
                if (type == "error")
                {
                    var msg = doc.RootElement.TryGetProperty("message", out var m)
                        ? m.GetString() : "unknown error";
                    var errorCode = doc.RootElement.TryGetProperty("errorCode", out var ec)
                        ? ec.GetString() ?? "sidecar_session_create_failed"
                        : "sidecar_session_create_failed";
                    throw new SidecarProtocolException(
                        errorCode,
                        $"Sidecar reported error for session {SessionId}: {msg}");
                }
            }
            catch (JsonException ex)
            {
                throw new InvalidOperationException(
                    $"Sidecar sent malformed JSON during handshake (session {SessionId}): {ex.Message}");
            }
        }
    }

    private async Task ReceiveLoopAsync(CancellationToken ct, List<byte[]>? preReadyFrames = null)
    {
        var buf    = ArrayPool<byte>.Shared.Rent(256 * 1024);
        int filled = 0;
        const int MaxFrameSize = 64 * 1024 * 1024;

        try
        {
            if (preReadyFrames is { Count: > 0 })
            {
                foreach (var frame in preReadyFrames)
                    RouteFrame(frame, frame.Length);
                preReadyFrames.Clear();
            }

            while (!ct.IsCancellationRequested && _ws.State == WebSocketState.Open)
            {
                if (filled == buf.Length)
                {
                    if (buf.Length >= MaxFrameSize) { filled = 0; }
                    else
                    {
                        var bigger = ArrayPool<byte>.Shared.Rent(Math.Min(buf.Length * 2, MaxFrameSize));
                        Buffer.BlockCopy(buf, 0, bigger, 0, filled);
                        ArrayPool<byte>.Shared.Return(buf);
                        buf = bigger;
                    }
                }

                var result = await _ws.ReceiveAsync(buf.AsMemory(filled), ct);
                if (result.MessageType == WebSocketMessageType.Close) break;

                filled += result.Count;
                if (!result.EndOfMessage) continue;

                if (result.MessageType == WebSocketMessageType.Binary)
                    RouteFrame(buf, filled);
                else
                    HandleTextMessage(Encoding.UTF8.GetString(buf, 0, filled));

                filled = 0;
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            Console.Error.WriteLine($"[SidecarClient:{SessionId}] Receive loop error: {ex.Message}");
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buf);
            _video.Writer.TryComplete();
            _control.Writer.TryComplete();
            _stateExportTcs?.TrySetException(new OperationCanceledException("Sidecar receive loop ended."));
        }
    }

    private void HandleTextMessage(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            if (!doc.RootElement.TryGetProperty("type", out var typeEl)) return;

            var type = typeEl.GetString();
            if (type == "stateExport")
            {
                if (_stateExportTcs is null) return;

                var state = JsonSerializer.Deserialize<BrowserStatePayload>(
                    doc.RootElement.GetProperty("state").GetRawText(), JsonOptions)
                    ?? new BrowserStatePayload();

                _stateExportTcs.TrySetResult(state);
                _stateExportTcs = null;
                return;
            }

            if (type == "diagResult")
            {
                if (_diagProbeTcs is null) return;
                var requestId = doc.RootElement.TryGetProperty("requestId", out var rid)
                    ? rid.GetString()
                    : null;
                if (_diagProbeRequestId is not null
                    && !string.Equals(requestId, _diagProbeRequestId, StringComparison.Ordinal))
                    return;

                if (doc.RootElement.TryGetProperty("ok", out var okEl) && okEl.ValueKind == JsonValueKind.False)
                {
                    var err = doc.RootElement.TryGetProperty("errorCode", out var ec)
                        ? ec.GetString() ?? "probe_failed"
                        : "probe_failed";
                    _diagProbeTcs.TrySetException(new InvalidOperationException(err));
                }
                else
                {
                    object data = doc.RootElement.TryGetProperty("data", out var dataEl)
                        ? JsonSerializer.Deserialize<object>(dataEl.GetRawText(), JsonOptions) ?? new { }
                        : new { };
                    _diagProbeTcs.TrySetResult(data);
                }

                _diagProbeTcs = null;
                _diagProbeRequestId = null;
                return;
            }

            if (_stateExportTcs is not null && type is "stateExportError" or "error")
            {
                var msg = doc.RootElement.TryGetProperty("message", out var m)
                    ? m.GetString() ?? "state export failed"
                    : "state export failed";
                var errorCode = doc.RootElement.TryGetProperty("errorCode", out var ec)
                    ? ec.GetString() ?? "export_failed"
                    : "export_failed";
                FailStateExport(new SidecarProtocolException(errorCode, msg));
            }
        }
        catch (Exception ex)
        {
            FailStateExport(ex);
            _diagProbeTcs?.TrySetException(ex);
            _diagProbeTcs = null;
            _diagProbeRequestId = null;
        }
    }

    private void FailStateExport(Exception ex)
    {
        _stateExportTcs?.TrySetException(ex);
        _stateExportTcs = null;
    }

    private void RouteFrame(byte[] buf, int len)
    {
        if (len < 1) return;
        var type = buf[0];

        if (type == SidecarProtocol.MsgScreencast)
        {
            if (len < 2) return;
            var frame = new byte[len];
            Buffer.BlockCopy(buf, 0, frame, 0, len);
            _video.Writer.TryWrite(frame.AsMemory());
            return;
        }

        if (type == SidecarProtocol.MsgH264)
        {
            if (len < 6) return;
            var frame = new byte[len];
            Buffer.BlockCopy(buf, 0, frame, 0, len);
            _video.Writer.TryWrite(frame.AsMemory());
            return;
        }

        if (type is SidecarProtocol.MsgUrl
                  or SidecarProtocol.MsgConsole
                  or SidecarProtocol.MsgEvalResult
                  or SidecarProtocol.MsgStatus
                  or SidecarProtocol.MsgRedirect)
        {
            var msg = new byte[len];
            Buffer.BlockCopy(buf, 0, msg, 0, len);
            _control.Writer.TryWrite(msg.AsMemory());
        }
    }

    public Task SendInputAsync(ReadOnlyMemory<byte> raw, CancellationToken ct = default)
        => SendCoreAsync(raw, ct);

    private async Task SendCoreAsync(ReadOnlyMemory<byte> data, CancellationToken ct)
    {
        await _sendLock.WaitAsync(ct);
        try
        {
            if (_ws.State != WebSocketState.Open) return;
            await _ws.SendAsync(data, WebSocketMessageType.Text, true, ct);
        }
        finally
        {
            _sendLock.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _cts.CancelAsync();

        if (_receiveTask is not null)
        {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await _receiveTask.WaitAsync(timeout.Token);
            }
            catch { /* best-effort */ }
        }

        _video.Writer.TryComplete();
        _control.Writer.TryComplete();
        _stateExportTcs?.TrySetCanceled();

        try
        {
            if (_ws.State is WebSocketState.Open or WebSocketState.CloseReceived)
                await _ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "session ended",
                    CancellationToken.None);
        }
        catch { }
        finally
        {
            _ws.Dispose();
            _cts.Dispose();
            _sendLock.Dispose();
        }
    }
}
