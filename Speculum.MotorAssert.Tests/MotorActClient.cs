using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
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
            .AddMessagePackProtocol()
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
        var token = await InvokeStartWithRetryAsync(clientUrl, width, height, identity, ct);
        StartSessionPumps();
        return token;
    }

    private async Task<string> InvokeStartWithRetryAsync(
        string clientUrl,
        int width,
        int height,
        MotorSessionIdentity identity,
        CancellationToken ct)
    {
        try
        {
            return await _connection!.InvokeAsync<string>(
                "StartSessionAsync", clientUrl, width, height, identity, ct);
        }
        catch (Exception ex) when (
            ex.Message.Contains("Falha ao iniciar", StringComparison.OrdinalIgnoreCase))
        {
            // One retry after sidecar create flakes (display reuse / prior probe hang).
            await Task.Delay(1500, ct);
            return await _connection!.InvokeAsync<string>(
                "StartSessionAsync", clientUrl, width, height, identity, ct);
        }
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
        // Hub method runs until the channel completes — fire-and-forget the SendAsync task.
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

    public Task ResizeAsync(int width, int height, CancellationToken ct = default)
    {
        EnsureConnected();
        return _connection!.InvokeAsync("ResizeAsync", width, height, ct);
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
public sealed class MotorFrame
{
    public byte[] Jpeg { get; set; } = [];
    public long Sequence { get; set; }
    public long Timestamp { get; set; }
}

/// <summary>MessagePack mirror of SessionStatus.</summary>
public sealed class MotorSessionStatus
{
    public int TabCount { get; set; }
    public string Url { get; set; } = "";
    public bool Resizing { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public double Fps { get; set; }
    public long UptimeMs { get; set; }
    public string SessionId { get; set; } = "";
    public bool JsBridgeEnabled { get; set; }
}

/// <summary>MessagePack mirror of ConsoleOutput (binary payload).</summary>
public sealed class MotorConsoleOutput
{
    public byte[] Data { get; set; } = [];
}

/// <summary>MessagePack mirror of ConsoleInput.</summary>
public sealed class MotorConsoleInput
{
    public int Id { get; set; }
    public required string Code { get; set; }
}
