using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Websete.Speculum.Host.Virtualization.Contracts;
using Websete.Speculum.Host.Virtualization.Models;
using Websete.Speculum.Host.Virtualization.Options;
using Websete.Speculum.Host.Virtualization.Sidecar;

namespace Websete.Speculum.Host.Virtualization;

public class VSession : IVSession
{
    // ── Estado ────────────────────────────────────────────────────────────────

    const int StateStopped = 0;
    const int StateRunning = 1;

    // ── Configuração ──────────────────────────────────────────────────────────

    private readonly SidecarBrowserClientOptions     _sidecarOptions;
    private readonly VirtualBrowserConnectionOptions _connectionOptions;
    private readonly ILogger                         _logger;

    /// <summary>
    /// Per-session URL rewriter derived from the active ForwardingProfile.
    /// <see cref="UrlRewriter.Passthrough"/> when no profile matches.
    /// </summary>
    private readonly UrlRewriter _urlRewriter;

    /// <summary>
    /// Profile-derived initial URL (e.g. <c>https://olx.com.br</c>).
    /// Overrides <see cref="VirtualBrowserConnectionOptions.InitialUrl"/> when set.
    /// </summary>
    private readonly string? _initialUrl;

    // ── Recursos próprios ─────────────────────────────────────────────────────

    private int _sessionState;
    private SidecarClient? _client;
    private CancellationTokenSource _cts = new();

    // Output pump tasks — started in StartAsync, awaited in StopAsync.
    private Task _pumpFramesTask     = Task.CompletedTask;
    private Task _pumpConsoleTask    = Task.CompletedTask;
    // Input pump tasks — started lazily via ConsumeUserInput / ConsumeConsoleInput.
    // Each method is called at most once per session, so a dedicated field suffices.
    private Task _pumpUserInputTask    = Task.CompletedTask;
    private Task _pumpConsoleInputTask = Task.CompletedTask;

    private readonly Channel<Frame>         _frameChannel;
    private readonly Channel<ConsoleOutput> _consoleOutputChannel;

    /// <summary>
    /// Dedicated channel for session health snapshots (MSG_STATUS 0x09).
    /// Bounded/DropOldest — only the latest snapshot matters; stale status
    /// should never queue behind slow consumers.
    /// </summary>
    private readonly Channel<SessionStatus> _statusChannel;

    // ── Métricas para status ──────────────────────────────────────────────────

    /// <summary>Frame counter incremented on every JPEG screencast frame received.</summary>
    private int      _frameCount     = 0;
    /// <summary>Measured FPS at the last status sample window.</summary>
    private double   _lastFps        = 0;
    /// <summary>Start of the current 1-second FPS measurement window.</summary>
    private DateTime _fpsWindowStart = DateTime.UtcNow;
    /// <summary>Timestamp when the session was started (set in StartAsync).</summary>
    private DateTime _startTime;
    /// <summary>Sidecar-assigned session identifier (set in StartAsync).</summary>
    private string   _sessionId      = "";

    // ── Construtor ────────────────────────────────────────────────────────────

    /// <param name="sidecarOptions">Sidecar WebSocket endpoint configuration.</param>
    /// <param name="connectionOptions">Default browser connection parameters.</param>
    /// <param name="logger">Logger for lifecycle/error messages.</param>
    /// <param name="urlRewriter">
    ///   Bidirectional URL rewriter for the active ForwardingProfile.
    ///   Pass <see langword="null"/> (or omit) when no profile is active;
    ///   <see cref="UrlRewriter.Passthrough"/> is used and all URLs pass through unchanged.
    /// </param>
    /// <param name="initialUrl">
    ///   Profile-derived initial URL (e.g. <c>https://olx.com.br</c>).
    ///   When provided, overrides <see cref="VirtualBrowserConnectionOptions.InitialUrl"/>.
    /// </param>
    public VSession(
        SidecarBrowserClientOptions     sidecarOptions,
        VirtualBrowserConnectionOptions connectionOptions,
        ILogger                         logger,
        UrlRewriter?                    urlRewriter = null,
        string?                         initialUrl  = null)
    {
        _sidecarOptions    = sidecarOptions;
        _connectionOptions = connectionOptions;
        _logger            = logger;
        _urlRewriter       = urlRewriter ?? UrlRewriter.Passthrough;
        _initialUrl        = initialUrl;

        _frameChannel = Channel.CreateBounded<Frame>(new BoundedChannelOptions(2)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = true,
        });

        _consoleOutputChannel = Channel.CreateUnbounded<ConsoleOutput>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });

        // Status: bounded 2, DropOldest — only the latest snapshot is relevant.
        _statusChannel = Channel.CreateBounded<SessionStatus>(new BoundedChannelOptions(2)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = true,
        });

        _sessionState = StateStopped;
    }

    // ── Ciclo de vida ─────────────────────────────────────────────────────────

    public async Task StartAsync(CancellationToken ct = default)
    {
        if (Interlocked.Exchange(ref _sessionState, StateRunning) == StateRunning)
            throw new InvalidOperationException("A sessão já está em execução.");

        _client    = new SidecarClient(Guid.NewGuid().ToString("N"));
        _startTime = DateTime.UtcNow;
        _sessionId = _client.SessionId;

        // Profile-derived initialUrl takes precedence over the global default.
        var effectiveUrl = _initialUrl ?? _connectionOptions.InitialUrl;

        await _client.ConnectAsync(
            _sidecarOptions.SidecarBaseUrl,
            _connectionOptions.Width,
            _connectionOptions.Height,
            effectiveUrl,
            scripts:         _connectionOptions.Scripts.Count > 0 ? _connectionOptions.Scripts : null,
            jsBridgeEnabled: _connectionOptions.JsBridgeEnabled,
            upstreamDomain:  _urlRewriter.UpstreamDomain,
            ct:              ct);

        _pumpFramesTask  = PumpFramesAsync(_cts.Token);
        _pumpConsoleTask = PumpConsoleOutputAsync(_cts.Token);
    }

    public async Task StopAsync(CancellationToken ct = default)
    {
        if (Interlocked.Exchange(ref _sessionState, StateStopped) == StateStopped)
            return;

        _logger.LogInformation("Finalizando sessão de virtualização...");

        await _cts.CancelAsync();
        try
        {
            await Task.WhenAll(
                _pumpFramesTask, _pumpConsoleTask,
                _pumpUserInputTask, _pumpConsoleInputTask);
        }
        catch { }

        _frameChannel.Writer.TryComplete();
        _consoleOutputChannel.Writer.TryComplete();
        _statusChannel.Writer.TryComplete();

        if (_client is not null)
        {
            try { await _client.DisposeAsync(); }
            catch (Exception ex) { _logger.LogWarning(ex, "Erro ao fechar o SidecarClient."); }
        }

        _cts.Dispose();
    }

    // ── Channels ──────────────────────────────────────────────────────────────

    public ChannelReader<Frame>         GetFrameReader()         => _frameChannel.Reader;
    public ChannelReader<ConsoleOutput> GetConsoleOutputReader() => _consoleOutputChannel.Reader;
    public ChannelReader<SessionStatus> GetStatusReader()        => _statusChannel.Reader;

    /// <summary>
    /// Starts and returns the pump task for user input events.
    /// The caller MUST await this task — SignalR keeps the client→server streaming
    /// channel alive only while the hub method's returned Task is pending.
    /// If the method returns void (or a completed Task), SignalR immediately marks
    /// the ChannelReader as complete, causing ReadAllAsync to yield nothing.
    /// </summary>
    public Task ConsumeUserInputAsync(ChannelReader<UserInput> channelReader)
    {
        if (_client is null) throw new InvalidOperationException("Sessão não iniciada.");
        _pumpUserInputTask = PumpUserInputAsync(channelReader, _cts.Token);
        return _pumpUserInputTask;
    }

    public Task ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader)
    {
        if (_client is null) throw new InvalidOperationException("Sessão não iniciada.");
        _pumpConsoleInputTask = PumpConsoleInputAsync(channelReader, _cts.Token);
        return _pumpConsoleInputTask;
    }

    // ── Controlo ──────────────────────────────────────────────────────────────

    public Task NavigateAsync(string url, CancellationToken ct = default)
    {
        // Rewrite downstream → upstream so the virtual browser navigates to
        // the real site (e.g. https://websete.localhost/foo → https://olx.com.br/foo).
        var upstreamUrl = _urlRewriter.DownstreamToUpstream(url);
        return _client!.SendInputAsync(
            JsonSerializer.SerializeToUtf8Bytes(new { type = "navigate", url = upstreamUrl }).AsMemory(), ct);
    }

    public Task ResizeAsync(int width, int height, CancellationToken ct = default)
        => _client!.SendInputAsync(
            JsonSerializer.SerializeToUtf8Bytes(new { type = "resize", width, height }).AsMemory(), ct);

    // ── Output pumps ──────────────────────────────────────────────────────────

    private async Task PumpFramesAsync(CancellationToken ct)
    {
        try
        {
            await foreach (var data in _client!.VideoChannel.ReadAllAsync(ct))
            {
                // Count frames for FPS measurement (read in DecodeAndAugmentStatus).
                Interlocked.Increment(ref _frameCount);

                _frameChannel.Writer.TryWrite(new Frame
                {
                    Data      = data,
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                });
            }
        }
        catch (OperationCanceledException) { }
        finally { _frameChannel.Writer.TryComplete(); }
    }

    private async Task PumpConsoleOutputAsync(CancellationToken ct)
    {
        try
        {
            await foreach (var raw in _client!.ControlChannel.ReadAllAsync(ct))
            {
                if (raw.IsEmpty) continue;

                // ── MSG_STATUS (0x09) — intercept, augment, route to status channel ──
                // Never forwarded to the client via the console output channel so as
                // not to pollute the existing binary protocol stream.
                if (raw.Span[0] == SidecarProtocol.MsgStatus)
                {
                    var status = DecodeAndAugmentStatus(raw);
                    if (status is not null)
                        _statusChannel.Writer.TryWrite(status);
                    continue;
                }

                // ── MSG_URL (0x04) — rewrite upstream→downstream before forwarding ──
                var data = raw;
                if (raw.Span[0] == SidecarProtocol.MsgUrl)
                    data = _urlRewriter.RewriteUrlFrame(raw);

                if (data.Span[0] is SidecarProtocol.MsgUrl
                                 or SidecarProtocol.MsgConsole
                                 or SidecarProtocol.MsgEvalResult
                                 or SidecarProtocol.MsgRedirect)
                    _consoleOutputChannel.Writer.TryWrite(new ConsoleOutput { Data = data });
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            _consoleOutputChannel.Writer.TryComplete();
            _statusChannel.Writer.TryComplete();
        }
    }

    // ── Input pumps ───────────────────────────────────────────────────────────

    private async Task PumpUserInputAsync(ChannelReader<UserInput> reader, CancellationToken ct)
    {
        try
        {
            await foreach (var ev in reader.ReadAllAsync(ct))
            {
                try
                {
                    await _client!.SendInputAsync(Encoding.UTF8.GetBytes(ev.Payload).AsMemory(), ct);
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex) when (ex is not OutOfMemoryException)
                {
                    _logger.LogWarning(ex, "Erro ao enviar input de usuário para o sidecar.");
                }
            }
        }
        catch (OperationCanceledException) { /* normal shutdown */ }
    }

    private async Task PumpConsoleInputAsync(ChannelReader<ConsoleInput> reader, CancellationToken ct)
    {
        try
        {
            await foreach (var ev in reader.ReadAllAsync(ct))
            {
                try
                {
                    var payload = JsonSerializer.SerializeToUtf8Bytes(new
                    {
                        type = "evaljs",
                        id   = ev.Id,
                        code = ev.Code,
                    });
                    await _client!.SendInputAsync(payload.AsMemory(), ct);
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex) when (ex is not OutOfMemoryException)
                {
                    _logger.LogWarning(ex, "Erro ao enviar evaljs para o sidecar (id={Id}).", ev.Id);
                }
            }
        }
        catch (OperationCanceledException) { /* normal shutdown */ }
    }

    // ── Status augmentation ───────────────────────────────────────────────────

    /// <summary>
    /// Decodes a raw MSG_STATUS (0x09) frame from the sidecar, computes
    /// .NET-side metrics (FPS, uptime), and returns a complete
    /// <see cref="SessionStatus"/> snapshot.
    ///
    /// Frame layout (matches Protocol.ts <c>encodeStatusFrame</c>):
    ///   [0]     type = 0x09             (1 byte)
    ///   [1..4]  len                     (4 bytes LE uint32)
    ///   [5..]   JSON payload            (len bytes UTF-8)
    ///
    /// Returns <see langword="null"/> on parse failure — caller silently drops.
    /// </summary>
    private SessionStatus? DecodeAndAugmentStatus(ReadOnlyMemory<byte> raw)
    {
        if (raw.Length < 5) return null;
        var len = (int)BinaryPrimitives.ReadUInt32LittleEndian(raw.Span.Slice(1, 4));
        if (5 + len > raw.Length) return null;

        try
        {
            using var doc = JsonDocument.Parse(raw.Slice(5, len));
            var root = doc.RootElement;

            // ── FPS: sample the frame counter over the elapsed window ─────────
            // _frameCount is incremented atomically by PumpFramesAsync.
            // DecodeAndAugmentStatus is called only from PumpConsoleOutputAsync
            // (single task), so _lastFps/_fpsWindowStart need no synchronisation.
            var now     = DateTime.UtcNow;
            var elapsed = (now - _fpsWindowStart).TotalSeconds;
            if (elapsed >= 1.0)
            {
                var count       = Interlocked.Exchange(ref _frameCount, 0);
                _lastFps        = Math.Round(count / elapsed, 1);
                _fpsWindowStart = now;
            }

            return new SessionStatus
            {
                TabCount        = root.TryGetProperty("tabCount", out var tc) ? tc.GetInt32()     : -1,
                Url             = root.TryGetProperty("url",      out var u)  ? u.GetString() ?? "" : "",
                Resizing        = root.TryGetProperty("resizing", out var r)  && r.GetBoolean(),
                Width           = root.TryGetProperty("width",    out var w)  ? w.GetInt32()     : 0,
                Height          = root.TryGetProperty("height",   out var h)  ? h.GetInt32()     : 0,
                Fps             = _lastFps,
                UptimeMs        = (long)(now - _startTime).TotalMilliseconds,
                SessionId       = _sessionId,
                JsBridgeEnabled = _connectionOptions.JsBridgeEnabled,
            };
        }
        catch { return null; }
    }
}
