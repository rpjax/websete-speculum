using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using MessagePack;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;

namespace Speculum.MotorAssert.Tests;

/// <summary>
/// Act client MessagePack para /vhub — espelha o contrato do MotorHub
/// (StartSession / Navigate / Resize + canais frame/status/console/input).
/// </summary>
public sealed class MotorActClient : IAsyncDisposable
{
    private readonly MotorAssertHost _host;
    private HubConnection? _connection;
    private ChannelWriter<string>? _userInputWriter;
    private ChannelWriter<MotorConsoleInput>? _consoleInputWriter;
    private CancellationTokenSource? _pumpCts;
    private Task? _statusPump;
    private Task? _framePump;
    private Task? _consolePump;
    private readonly ConcurrentQueue<MotorSessionStatus> _statuses = new();
    private readonly ConcurrentQueue<string> _redirectUrls = new();
    private long _framesReceived;
    private MotorFrame? _lastFrame;
    private long _lastFrameSequence;
    private long _consoleChunks;

    public MotorActClient(MotorAssertHost host) => _host = host;

    public string? ConnectionId => _connection?.ConnectionId;
    public long FramesReceived => Interlocked.Read(ref _framesReceived);
    public long LastFrameSequence => Interlocked.Read(ref _lastFrameSequence);
    public MotorFrame? LastFrame => _lastFrame;
    public long ConsoleChunks => Interlocked.Read(ref _consoleChunks);
    public IReadOnlyCollection<string> RedirectUrls => _redirectUrls.ToArray();

    public async Task ConnectAsync(CancellationToken ct = default)
    {
        var motorHost = Environment.GetEnvironmentVariable("MOTOR_ASSERT_MOTOR_HOST") ?? "speculum.test";

        _connection = new HubConnectionBuilder()
            .WithUrl($"{_host.ApiBase}/vhub", o =>
            {
                o.Transports = HttpTransportType.WebSockets;
                o.SkipNegotiation = false;
                o.HttpMessageHandlerFactory = _ => new HostHeaderHandler(motorHost);
            })
            .AddMessagePackProtocol(options =>
            {
                // Keep Act client wire keys in lockstep with Speculum.Api MotorHubMessagePack.
                options.SerializerOptions = MessagePackSerializerOptions.Standard
                    .WithResolver(MessagePack.Resolvers.CompositeResolver.Create(
                        MessagePack.Resolvers.StandardResolver.Instance,
                        MessagePack.Resolvers.ContractlessStandardResolver.Instance))
                    .WithSecurity(MessagePackSecurity.UntrustedData);
            })
            .WithAutomaticReconnect()
            .Build();

        await _connection.StartAsync(ct);
    }

    public async Task<string> StartSessionAsync(
        string clientUrl,
        string correlationId,
        string? clientToken = null,
        int width = 1280,
        int height = 720,
        IReadOnlyDictionary<string, string>? indexers = null,
        MotorDeviceProfile? device = null,
        CancellationToken ct = default)
    {
        EnsureConnected();
        Dictionary<string, string>? indexerCopy = null;
        if (indexers is not null)
            indexerCopy = new Dictionary<string, string>(indexers, StringComparer.Ordinal);
        var identity = new MotorSessionIdentity
        {
            CorrelationId = correlationId,
            ClientToken = clientToken,
            Indexers = indexerCopy,
        };
        var token = await _connection!.InvokeAsync<string>(
            "StartSessionAsync", clientUrl, width, height, identity, device, ct);
        StartSessionPumps();
        return token;
    }

    private void StartSessionPumps()
    {
        if (_pumpCts is not null)
            return;

        _pumpCts = new CancellationTokenSource();
        var ct = _pumpCts.Token;
        _statusPump = PumpStatusesAsync(ct);
        _framePump = PumpFramesAsync(ct);
        _consolePump = PumpConsoleAsync(ct);
    }

    private async Task PumpStatusesAsync(CancellationToken ct)
    {
        await foreach (var status in _connection!.StreamAsync<MotorSessionStatus>("OpenStatusChannel", cancellationToken: ct))
            _statuses.Enqueue(status);
    }

    private async Task PumpFramesAsync(CancellationToken ct)
    {
        await foreach (var frame in _connection!.StreamAsync<MotorFrame>("OpenFrameChannel", cancellationToken: ct))
        {
            _lastFrame = frame;
            Interlocked.Exchange(ref _lastFrameSequence, frame.Sequence);
            Interlocked.Increment(ref _framesReceived);
        }
    }

    private async Task PumpConsoleAsync(CancellationToken ct)
    {
        await foreach (var chunk in _connection!.StreamAsync<MotorConsoleOutput>("OpenConsoleOutputChannel", cancellationToken: ct))
        {
            Interlocked.Increment(ref _consoleChunks);
            if (chunk.Data is { Length: >= 5 } data && data[0] == 0x0A)
            {
                var len = System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(data.AsSpan(1, 4));
                if (5 + len <= data.Length)
                    _redirectUrls.Enqueue(Encoding.UTF8.GetString(data, 5, (int)len));
            }
        }
    }

    public async Task OpenUserInputChannelAsync(CancellationToken ct = default)
    {
        EnsureConnected();
        if (_userInputWriter is not null)
            return;

        var channel = Channel.CreateUnbounded<string>();
        _userInputWriter = channel.Writer;
        // Hub stream subscription is fire-and-forget; brief settle before writers are used.
        _ = _connection!.SendAsync("OpenUserInputChannel", channel.Reader, ct);
        await Task.Delay(75, ct);
    }

    public async Task OpenConsoleInputChannelAsync(CancellationToken ct = default)
    {
        EnsureConnected();
        if (_consoleInputWriter is not null)
            return;

        var channel = Channel.CreateUnbounded<MotorConsoleInput>();
        _consoleInputWriter = channel.Writer;
        _ = _connection!.SendAsync("OpenConsoleInputChannel", channel.Reader, ct);
        await Task.Delay(75, ct);
    }

    public async Task SendUserInputJsonAsync(string json, CancellationToken ct = default)
    {
        await OpenUserInputChannelAsync(ct);
        await _userInputWriter!.WriteAsync(json, ct);
    }

    public async Task SendClickAsync(double x, double y, CancellationToken ct = default)
    {
        await SendUserInputJsonAsync(
            JsonSerializer.Serialize(new { type = "mousedown", x, y, button = 0 }), ct);
        await SendUserInputJsonAsync(
            JsonSerializer.Serialize(new { type = "mouseup", x, y, button = 0 }), ct);
    }

    public Task SendWheelAsync(double x, double y, double deltaY = 120, CancellationToken ct = default) =>
        SendUserInputJsonAsync(
            JsonSerializer.Serialize(new { type = "wheel", x, y, deltaX = 0, deltaY }),
            ct);

    public Task SendKeyAsync(string key, CancellationToken ct = default) =>
        SendUserInputJsonAsync(JsonSerializer.Serialize(new { type = "keydown", key }), ct);

    public Task SendGoBackAsync(CancellationToken ct = default) =>
        SendUserInputJsonAsync("""{"type":"goback"}""", ct);

    public Task SendGoForwardAsync(CancellationToken ct = default) =>
        SendUserInputJsonAsync("""{"type":"goforward"}""", ct);

    public Task SendTouchAsync(
        string phase,
        object[] points,
        int[] changedIds,
        CancellationToken ct = default) =>
        SendUserInputJsonAsync(
            JsonSerializer.Serialize(new { type = "touch", phase, points, changedIds }),
            ct);

    public async Task SendTouchTapAsync(double x, double y, int id = 1, CancellationToken ct = default)
    {
        var point = new { id, x, y, radiusX = 1.0, radiusY = 1.0, force = 0.5 };
        await SendTouchAsync("start", [point], [id], ct);
        await SendTouchAsync("end", [], [id], ct);
    }

    public Task SendTextAsync(string text, CancellationToken ct = default) =>
        SendUserInputJsonAsync(JsonSerializer.Serialize(new { type = "text", text }), ct);

    public async Task WaitForRedirectAsync(TimeSpan timeout, CancellationToken ct = default)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (!_redirectUrls.IsEmpty)
                return;
            await Task.Delay(50, ct);
        }

        throw new TimeoutException("Timed out waiting for MsgRedirect on console channel.");
    }

    public async Task EvalJsAsync(int id, string code, CancellationToken ct = default)
    {
        await OpenConsoleInputChannelAsync(ct);
        await _consoleInputWriter!.WriteAsync(new MotorConsoleInput { Id = id, Code = code }, ct);
    }

    public Task NavigateAsync(string clientUrl, CancellationToken ct = default)
    {
        EnsureConnected();
        return _connection!.InvokeAsync("NavigateAsync", clientUrl, ct);
    }

    public Task<MotorResizeResult> ResizeAsync(
        int width,
        int height,
        MotorDeviceProfile? device = null,
        CancellationToken ct = default)
    {
        EnsureConnected();
        // Always send the device arg (even null) so MessagePack arity matches MotorHub.ResizeAsync.
        return _connection!.InvokeAsync<MotorResizeResult>("ResizeAsync", width, height, device, ct);
    }

    /// <summary>Wait until a JPEG frame reports exact SOF dimensions.</summary>
    public async Task WaitForJpegGeometryAsync(int width, int height, TimeSpan timeout, CancellationToken ct = default)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            var frame = LastFrame;
            if (frame?.Jpeg is { Length: > 0 } jpeg
                && TryReadJpegDimensions(jpeg, out var w, out var h)
                && w == width && h == height)
            {
                return;
            }

            await Task.Delay(200, ct);
        }

        throw new TimeoutException($"Timed out waiting for JPEG {width}×{height}.");
    }

    private static bool TryReadJpegDimensions(byte[] buf, out int width, out int height)
    {
        width = 0;
        height = 0;
        if (buf.Length < 4 || buf[0] != 0xff || buf[1] != 0xd8) return false;
        var i = 2;
        while (i + 9 < buf.Length)
        {
            if (buf[i] != 0xff) { i++; continue; }
            var marker = buf[i + 1];
            if (marker is 0x00 or 0xd8 or 0xd9 || (marker >= 0xd0 && marker <= 0xd7))
            {
                i += 2;
                continue;
            }

            if (i + 3 >= buf.Length) return false;
            var segLen = (buf[i + 2] << 8) | buf[i + 3];
            if (segLen < 2) return false;
            if (marker is 0xc0 or 0xc2)
            {
                height = (buf[i + 5] << 8) | buf[i + 6];
                width = (buf[i + 7] << 8) | buf[i + 8];
                return true;
            }

            i += 2 + segLen;
        }

        return false;
    }

    public async Task<MotorSessionStatus> WaitForStatusAsync(
        Func<MotorSessionStatus, bool> predicate,
        TimeSpan timeout,
        CancellationToken ct = default)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            while (_statuses.TryDequeue(out var status))
            {
                if (predicate(status))
                    return status;
            }

            await Task.Delay(50, ct);
        }

        throw new TimeoutException($"Timed out waiting for SessionStatus after {timeout}.");
    }

    public async Task WaitForFramesAsync(int minFrames, TimeSpan timeout, CancellationToken ct = default)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            if (FramesReceived >= minFrames)
                return;
            await Task.Delay(50, ct);
        }

        throw new TimeoutException($"Timed out waiting for {minFrames} frames (got {FramesReceived}).");
    }

    /// <summary>
    /// Build a client URL whose NSO forces target host (Development: unencrypted Base64 JSON).
    /// Used to exercise allowlist reject against evil-fixture.test without apex remapping.
    /// </summary>
    public static string ClientUrlWithTargetHost(string clientOrigin, string targetHost, string path = "/")
    {
        var json = $"{{\"h\":\"{targetHost}\"}}";
        var nso = Uri.EscapeDataString(Convert.ToBase64String(Encoding.UTF8.GetBytes(json)));
        var origin = clientOrigin.TrimEnd('/');
        if (!path.StartsWith('/'))
            path = "/" + path;
        return $"{origin}{path}?_w7s_nso={nso}";
    }

    public async Task DisconnectAsync()
    {
        _userInputWriter?.TryComplete();
        _consoleInputWriter?.TryComplete();
        if (_pumpCts is not null)
        {
            await _pumpCts.CancelAsync();
            _pumpCts.Dispose();
            _pumpCts = null;
        }

        if (_connection is null) return;
        await _connection.StopAsync();
        await _connection.DisposeAsync();
        _connection = null;
    }

    public async ValueTask DisposeAsync() => await DisconnectAsync();

    private void EnsureConnected()
    {
        if (_connection is null || _connection.State != HubConnectionState.Connected)
            throw new InvalidOperationException("Hub is not connected.");
    }

    private sealed class HostHeaderHandler(string host) : HttpClientHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            request.Headers.Host = host;
            return base.SendAsync(request, cancellationToken);
        }
    }
}

/// <summary>MessagePack mirror of Speculum.Api Frame.</summary>
[MessagePackObject]
public sealed class MotorFrame
{
    [Key("jpeg")]
    public byte[] Jpeg { get; set; } = [];

    [Key("sequence")]
    public long Sequence { get; set; }

    [Key("timestamp")]
    public long Timestamp { get; set; }
}

/// <summary>MessagePack mirror of SessionStatus.</summary>
[MessagePackObject]
public sealed class MotorSessionStatus
{
    [Key("tabCount")]
    public int TabCount { get; set; }

    [Key("url")]
    public string Url { get; set; } = "";

    [Key("resizing")]
    public bool Resizing { get; set; }

    [Key("width")]
    public int Width { get; set; }

    [Key("height")]
    public int Height { get; set; }

    [Key("fps")]
    public double Fps { get; set; }

    [Key("uptimeMs")]
    public long UptimeMs { get; set; }

    [Key("sessionId")]
    public string SessionId { get; set; } = "";

    [Key("jsBridgeEnabled")]
    public bool JsBridgeEnabled { get; set; }

    [Key("editing")]
    public MotorEditingState? Editing { get; set; }
}

[MessagePackObject]
public sealed class MotorEditingState
{
    [Key("focused")]
    public bool Focused { get; set; }

    [Key("inputMode")]
    public string? InputMode { get; set; }

    [Key("multiline")]
    public bool Multiline { get; set; }

    [Key("tagName")]
    public string? TagName { get; set; }
}

/// <summary>MessagePack mirror of ConsoleOutput (binary payload).</summary>
[MessagePackObject]
public sealed class MotorConsoleOutput
{
    [Key("data")]
    public byte[] Data { get; set; } = [];
}

/// <summary>MessagePack mirror of ConsoleInput.</summary>
[MessagePackObject]
public sealed class MotorConsoleInput
{
    [Key("id")]
    public int Id { get; set; }

    [Key("code")]
    public required string Code { get; set; }
}

/// <summary>MessagePack mirror of ResizeResult.</summary>
[MessagePackObject]
public sealed class MotorResizeResult
{
    [Key("applied")]
    public bool Applied { get; set; }

    [Key("width")]
    public int Width { get; set; }

    [Key("height")]
    public int Height { get; set; }

    [Key("chromeWidth")]
    public int? ChromeWidth { get; set; }

    [Key("chromeHeight")]
    public int? ChromeHeight { get; set; }

    [Key("displayWidth")]
    public int? DisplayWidth { get; set; }

    [Key("displayHeight")]
    public int? DisplayHeight { get; set; }

    [Key("resizeId")]
    public string? ResizeId { get; set; }

    [Key("errorCode")]
    public string? ErrorCode { get; set; }

    [Key("phase")]
    public string? Phase { get; set; }

    [Key("message")]
    public string? Message { get; set; }
}
