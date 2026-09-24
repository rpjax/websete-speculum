using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.WebSockets;
using System.Threading.Channels;
using Microsoft.Extensions.Logging;
using Speculum.Supervisor.Control;
using Speculum.Supervisor.Wire;
using Speculum.Wire;

namespace Speculum.Orchestrator;

/// <summary>
/// Dono dos pares supervisor+Firefox. A application fala com o orquestrador;
/// o orquestrador é o consumidor do supervisor (doc 10, doc 15).
/// </summary>
public sealed class SessionRegistry(OrchestratorOptions options, ILogger<SessionRegistry> logger) : IDisposable
{
    private readonly ConcurrentDictionary<Guid, SessionPair> _pairs = new();
    private readonly object _allocateGate = new();
    private int _nextPort = options.ConsumerPortStart;

    public int Count => _pairs.Count;

    public int Capacity => options.MaxPairs;

    public bool FirefoxPresent => File.Exists(options.BrowserExecutable);

    public bool SupervisorPresent => File.Exists(options.SupervisorExecutable);

    public bool TryGet(Guid sessionId, out SessionPair pair) => _pairs.TryGetValue(sessionId, out pair!);

    public async Task<SessionPair> AllocateAsync(
        Guid sessionId,
        int width,
        int height,
        CancellationToken cancellationToken)
    {
        SessionPair pair;
        lock (_allocateGate)
        {
            if (_pairs.Count >= options.MaxPairs)
            {
                throw new InvalidOperationException("host_full");
            }

            if (!SupervisorPresent)
            {
                throw new FileNotFoundException("supervisor ausente", options.SupervisorExecutable);
            }

            if (!FirefoxPresent)
            {
                throw new FileNotFoundException("firefox ausente", options.BrowserExecutable);
            }

            pair = new SessionPair(sessionId, width, height, options, AllocatePort(), logger, Kill);
            if (!_pairs.TryAdd(sessionId, pair))
            {
                pair.Dispose();
                throw new InvalidOperationException("session_exists");
            }
        }

        try
        {
            await pair.StartAsync(cancellationToken).ConfigureAwait(false);
            return pair;
        }
        catch
        {
            _pairs.TryRemove(sessionId, out _);
            pair.Dispose();
            throw;
        }
    }

    public void Kill(Guid sessionId)
    {
        if (_pairs.TryRemove(sessionId, out var pair))
        {
            pair.Dispose();
        }
    }

    public void Dispose()
    {
        foreach (var id in _pairs.Keys)
        {
            Kill(id);
        }
    }

    private int AllocatePort()
    {
        while (true)
        {
            var port = Interlocked.Increment(ref _nextPort);
            if (port is < 1 or > 65535)
            {
                Interlocked.Exchange(ref _nextPort, options.ConsumerPortStart);
                continue;
            }

            if (_pairs.Values.Any(p => p.ConsumerPort == port))
            {
                continue;
            }

            return port;
        }
    }
}

/// <summary>
/// Um par supervisor+Firefox. O orquestrador segura o WS do supervisor
/// enquanto a application sobe/desce; caller sumido por N → SIGKILL.
/// </summary>
public sealed class SessionPair : IDisposable
{
    private const int QueueCapacity = 256;
    private const int ReceiveChunkBytes = 64 * 1024;

    private readonly OrchestratorOptions _options;
    private readonly ILogger _logger;
    private readonly Action<Guid> _onDead;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly Channel<byte[]> _toApp = Channel.CreateBounded<byte[]>(
        new BoundedChannelOptions(QueueCapacity)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false,
        });
    private readonly object _appGate = new();

    private Process? _supervisor;
    private ClientWebSocket? _upstream;
    private WebSocket? _app;
    private CancellationTokenSource? _detach;
    private Task? _upstreamPump;
    private byte[]? _lastContextCreated;
    private byte[]? _lastNavigated;
    private bool _ready;
    private bool _disposed;

    public SessionPair(
        Guid sessionId,
        int width,
        int height,
        OrchestratorOptions options,
        int consumerPort,
        ILogger logger,
        Action<Guid> onDead)
    {
        SessionId = sessionId;
        Width = width > 0 ? width : 1280;
        Height = height > 0 ? height : 800;
        _options = options;
        ConsumerPort = consumerPort;
        _logger = logger;
        _onDead = onDead;
        var stamp = sessionId.ToString("n");
        ProfileDir = Path.Combine(options.DataRoot, stamp);
        SocketPath = $"/tmp/speculum-{stamp}.sock";
    }

    public Guid SessionId { get; }

    public int Width { get; }

    public int Height { get; }

    public int ConsumerPort { get; }

    public string ProfileDir { get; }

    public string SocketPath { get; }

    public bool Ready => _ready;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(ProfileDir);

        var info = new ProcessStartInfo(_options.SupervisorExecutable)
        {
            UseShellExecute = false,
            WorkingDirectory = Path.GetDirectoryName(_options.SupervisorExecutable),
        };
        info.Environment["SPECULUM_BROWSER_BIN"] = _options.BrowserExecutable;
        info.Environment["SPECULUM_BROWSER_URL"] = "about:blank";
        info.Environment["SPECULUM_BROWSER_HEADLESS"] = "1";
        info.Environment["SPECULUM_BROWSER_PROFILE"] = ProfileDir;
        info.Environment["SPECULUM_BROWSER_SOCKET"] = SocketPath;
        info.Environment["SPECULUM_SUPERVISOR_PORT"] = ConsumerPort.ToString();
        info.Environment["SPECULUM_VIEWPORT_WIDTH"] = Width.ToString();
        info.Environment["SPECULUM_VIEWPORT_HEIGHT"] = Height.ToString();

        var process = new Process { StartInfo = info, EnableRaisingEvents = true };
        process.Exited += (_, _) =>
        {
            _logger.LogInformation("par {SessionId} supervisor saiu", SessionId);
            _lifetime.Cancel();
        };

        if (!process.Start())
        {
            throw new InvalidOperationException("spawn_failed");
        }

        _supervisor = process;
        _logger.LogInformation(
            "par {SessionId} pid={Pid} port={Port} perfil={Profile}",
            SessionId,
            process.Id,
            ConsumerPort,
            ProfileDir);

        _upstream = await ConnectSupervisorAsync(cancellationToken).ConfigureAwait(false);
        _upstreamPump = PumpUpstreamAsync(_lifetime.Token);
        await WaitReadyAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task ServeApplicationAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        CancelDetach();
        lock (_appGate)
        {
            if (_app is { State: WebSocketState.Open })
            {
                throw new InvalidOperationException("caller_attached");
            }

            _app = socket;
        }

        using var sessionCt = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token);
        try
        {
            await ReplayLifecycleAsync(socket, sessionCt.Token).ConfigureAwait(false);
            await SendResyncAsync(sessionCt.Token).ConfigureAwait(false);

            var drain = DrainApplicationAsync(socket, sessionCt.Token);
            var send = ForwardToApplicationAsync(socket, sessionCt.Token);
            await drain.ConfigureAwait(false);
            sessionCt.Cancel();
            try
            {
                await send.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
            }
        }
        finally
        {
            lock (_appGate)
            {
                if (ReferenceEquals(_app, socket))
                {
                    _app = null;
                }
            }

            StartDetach();
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        CancelDetach();
        _lifetime.Cancel();

        try
        {
            _upstream?.Abort();
        }
        catch (ObjectDisposedException)
        {
        }

        try
        {
            if (_supervisor is { HasExited: false })
            {
                _logger.LogInformation("SIGKILL par {SessionId} pid={Pid}", SessionId, _supervisor.Id);
                _supervisor.Kill(entireProcessTree: true);
                _supervisor.WaitForExit(5000);
            }
        }
        catch (InvalidOperationException)
        {
        }
        finally
        {
            _supervisor?.Dispose();
            _upstream?.Dispose();
            _lifetime.Dispose();
        }

        TryDeleteDir(ProfileDir);
        TryDeleteFile(SocketPath);
    }

    private async Task<ClientWebSocket> ConnectSupervisorAsync(CancellationToken cancellationToken)
    {
        var uri = new Uri($"ws://127.0.0.1:{ConsumerPort}/session");
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(20);
        Exception? last = null;
        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var socket = new ClientWebSocket();
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(2));
                await socket.ConnectAsync(uri, timeout.Token).ConfigureAwait(false);
                return socket;
            }
            catch (Exception ex) when (ex is WebSocketException or HttpRequestException or OperationCanceledException)
            {
                last = ex;
                socket.Dispose();
                if (_supervisor is { HasExited: true })
                {
                    throw new InvalidOperationException("supervisor_exited", ex);
                }

                await Task.Delay(150, cancellationToken).ConfigureAwait(false);
            }
        }

        throw new TimeoutException($"supervisor não abriu {uri}: {last?.Message}");
    }

    private async Task PumpUpstreamAsync(CancellationToken cancellationToken)
    {
        var socket = _upstream;
        if (socket is null)
        {
            return;
        }

        var buffer = new byte[ReceiveChunkBytes];
        using var assembled = new MemoryStream();

        try
        {
            while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                assembled.SetLength(0);
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(buffer, cancellationToken).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        return;
                    }

                    assembled.Write(buffer, 0, result.Count);
                }
                while (!result.EndOfMessage);

                if (result.MessageType != WebSocketMessageType.Binary || assembled.Length == 0)
                {
                    continue;
                }

                var frame = assembled.ToArray();
                ObserveLifecycle(frame);
                _toApp.Writer.TryWrite(frame);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (WebSocketException ex)
        {
            _logger.LogInformation("par {SessionId} ponte supervisor caiu: {Reason}", SessionId, ex.Message);
        }
        finally
        {
            _lifetime.Cancel();
        }
    }

    private void ObserveLifecycle(byte[] frame)
    {
        if (frame.Length < SchemaEnvelope.HeaderBytes)
        {
            return;
        }

        try
        {
            var (opcode, _, _, _) = SchemaEnvelope.ReadHeader(frame);
            if (opcode == OpViewportOpened.Code)
            {
                _lastContextCreated = frame;
                _ready = true;
            }
            else if (opcode == OpNavigated.Code || opcode == OpDocumentInstalled.Code)
            {
                _lastNavigated = frame;
                _ready = true;
            }
        }
        catch (InvalidDataException)
        {
        }
    }

    private async Task WaitReadyAsync(CancellationToken cancellationToken)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(25);
        while (!_ready)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (DateTime.UtcNow >= deadline)
            {
                throw new TimeoutException("browser não chegou em Ready/ContextCreated");
            }

            if (_supervisor is { HasExited: true })
            {
                throw new InvalidOperationException("supervisor_exited");
            }

            await Task.Delay(50, cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task ReplayLifecycleAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var created = _lastContextCreated;
        if (created is not null)
        {
            await socket
                .SendAsync(created, WebSocketMessageType.Binary, endOfMessage: true, cancellationToken)
                .ConfigureAwait(false);
        }

        var navigated = _lastNavigated;
        if (navigated is not null)
        {
            await socket
                .SendAsync(navigated, WebSocketMessageType.Binary, endOfMessage: true, cancellationToken)
                .ConfigureAwait(false);
        }
    }

    private async Task ForwardToApplicationAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            if (!await _toApp.Reader.WaitToReadAsync(cancellationToken).ConfigureAwait(false))
            {
                return;
            }

            while (_toApp.Reader.TryRead(out var frame))
            {
                if (socket.State != WebSocketState.Open)
                {
                    return;
                }

                await socket
                    .SendAsync(frame, WebSocketMessageType.Binary, endOfMessage: true, cancellationToken)
                    .ConfigureAwait(false);
            }
        }
    }

    private async Task SendResyncAsync(CancellationToken cancellationToken)
    {
        var socket = _upstream;
        if (socket is null || socket.State != WebSocketState.Open)
        {
            return;
        }

        var command = SchemaCommands.Resync(1, 0, ResyncForce.FromWalk);
        await socket.SendAsync(command, WebSocketMessageType.Binary, endOfMessage: true, cancellationToken)
            .ConfigureAwait(false);
    }

    private async Task DrainApplicationAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[ReceiveChunkBytes];
        using var assembled = new MemoryStream();
        try
        {
            while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                assembled.SetLength(0);
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(buffer, cancellationToken).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        return;
                    }

                    assembled.Write(buffer, 0, result.Count);
                }
                while (!result.EndOfMessage);

                if (result.MessageType != WebSocketMessageType.Binary || assembled.Length == 0)
                {
                    continue;
                }

                var upstream = _upstream;
                if (upstream is null || upstream.State != WebSocketState.Open)
                {
                    return;
                }

                await upstream
                    .SendAsync(assembled.ToArray(), WebSocketMessageType.Binary, endOfMessage: true, cancellationToken)
                    .ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (WebSocketException)
        {
        }
    }

    private void StartDetach()
    {
        CancelDetach();
        var cts = new CancellationTokenSource();
        _detach = cts;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(_options.DetachTimeout, cts.Token).ConfigureAwait(false);
                _logger.LogInformation("par {SessionId} sem caller — matando", SessionId);
                _onDead(SessionId);
            }
            catch (OperationCanceledException)
            {
            }
        }, CancellationToken.None);
    }

    private void CancelDetach()
    {
        try
        {
            _detach?.Cancel();
        }
        catch (ObjectDisposedException)
        {
        }

        _detach?.Dispose();
        _detach = null;
    }

    private static void TryDeleteDir(string path)
    {
        try
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, recursive: true);
            }
        }
        catch (IOException)
        {
        }
    }

    private static void TryDeleteFile(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (IOException)
        {
        }
    }
}
