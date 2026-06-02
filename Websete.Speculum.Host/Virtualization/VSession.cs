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

    private readonly SidecarBrowserClientOptions _sidecarOptions;
    private readonly VirtualBrowserConnectionOptions _connectionOptions;
    private readonly ILogger _logger;

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

    private readonly Channel<Frame> _frameChannel;
    private readonly Channel<ConsoleOutput> _consoleOutputChannel;

    // ── Construtor ────────────────────────────────────────────────────────────

    public VSession(
        SidecarBrowserClientOptions sidecarOptions,
        VirtualBrowserConnectionOptions connectionOptions,
        ILogger logger)
    {
        _sidecarOptions = sidecarOptions;
        _connectionOptions = connectionOptions;
        _logger = logger;

        _frameChannel = Channel.CreateBounded<Frame>(new BoundedChannelOptions(2)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = true,
        });

        _consoleOutputChannel = Channel.CreateUnbounded<ConsoleOutput>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });

        _sessionState = StateStopped;
    }

    // ── Ciclo de vida ─────────────────────────────────────────────────────────

    public async Task StartAsync(CancellationToken ct = default)
    {
        if (Interlocked.Exchange(ref _sessionState, StateRunning) == StateRunning)
            throw new InvalidOperationException("A sessão já está em execução.");

        _client = new SidecarClient(Guid.NewGuid().ToString("N"));

        await _client.ConnectAsync(
            _sidecarOptions.SidecarBaseUrl,
            _connectionOptions.Width,
            _connectionOptions.Height,
            _connectionOptions.InitialUrl,
            scripts:         _connectionOptions.Scripts.Count > 0 ? _connectionOptions.Scripts : null,
            jsBridgeEnabled: _connectionOptions.JsBridgeEnabled,
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

        if (_client is not null)
        {
            try { await _client.DisposeAsync(); }
            catch (Exception ex) { _logger.LogWarning(ex, "Erro ao fechar o SidecarClient."); }
        }

        _cts.Dispose();
    }

    // ── Channels ──────────────────────────────────────────────────────────────

    public ChannelReader<Frame> GetFrameReader() => _frameChannel.Reader;
    public ChannelReader<ConsoleOutput> GetConsoleOutputReader() => _consoleOutputChannel.Reader;

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
        => _client!.SendInputAsync(
            JsonSerializer.SerializeToUtf8Bytes(new { type = "navigate", url }).AsMemory(), ct);

    public Task ResizeAsync(int width, int height, CancellationToken ct = default)
        => _client!.SendInputAsync(
            JsonSerializer.SerializeToUtf8Bytes(new { type = "resize", width, height }).AsMemory(), ct);

    // ── Output pumps ──────────────────────────────────────────────────────────

    private async Task PumpFramesAsync(CancellationToken ct)
    {
        try
        {
            await foreach (var data in _client!.VideoChannel.ReadAllAsync(ct))
                _frameChannel.Writer.TryWrite(new Frame
                {
                    Data = data,
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                });
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
                if (raw.Span[0] is 0x04 /* MSG_URL */ or 0x05 /* MSG_CONSOLE */ or 0x06 /* MSG_EVAL_RESULT */)
                    _consoleOutputChannel.Writer.TryWrite(new ConsoleOutput { Data = raw });
            }
        }
        catch (OperationCanceledException) { }
        finally { _consoleOutputChannel.Writer.TryComplete(); }
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
                catch (OperationCanceledException) { throw; }          // let outer catch handle shutdown
                catch (Exception ex) when (ex is not OutOfMemoryException)
                {
                    // Sidecar WS hiccup — log and keep processing; do NOT kill the pump.
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
}
