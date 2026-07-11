using System.Buffers;
using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Websete.Speculum.Host.Virtualization.Contracts;
using Websete.Speculum.Host.Virtualization.Models;
using Websete.Speculum.Host.Virtualization.Options;
using Websete.Speculum.Host.Virtualization.Persistence;
using Websete.Speculum.Host.Virtualization.Sidecar;

namespace Websete.Speculum.Host.Virtualization;

public class VSession : IVSession
{
    const int StateStopped = 0;
    const int StateRunning = 1;

    private readonly SidecarBrowserClientOptions _sidecarOptions;
    private readonly SessionConfigSnapshot       _snapshot;
    private readonly ILogger                     _logger;

    private int _sessionState;
    private SidecarClient? _client;
    private CancellationTokenSource _cts = new();

    private Task _pumpFramesTask         = Task.CompletedTask;
    private Task _pumpConsoleTask        = Task.CompletedTask;
    private Task _pumpUserInputTask      = Task.CompletedTask;
    private Task _pumpConsoleInputTask   = Task.CompletedTask;

    private readonly Channel<Frame>         _frameChannel;
    private readonly Channel<ConsoleOutput> _consoleOutputChannel;
    private readonly Channel<SessionStatus> _statusChannel;

    private int      _frameCount     = 0;
    private long     _frameSequence  = 0;
    private double   _lastFps        = 0;
    private DateTime _fpsWindowStart = DateTime.UtcNow;
    private DateTime _startTime;
    private string   _sessionId      = "";
    private string   _lastUrl        = "";
    private string?  _cookieId;

    public string? CookieId
    {
        get => _cookieId;
        set => _cookieId = value;
    }

    public VSession(
        SidecarBrowserClientOptions sidecarOptions,
        SessionConfigSnapshot       snapshot,
        ILogger                     logger)
    {
        _sidecarOptions = sidecarOptions;
        _snapshot       = snapshot;
        _logger         = logger;
        _lastUrl        = snapshot.InitialUrl;

        _frameChannel = Channel.CreateBounded<Frame>(new BoundedChannelOptions(2)
        {
            FullMode     = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = true,
        });

        _consoleOutputChannel = Channel.CreateUnbounded<ConsoleOutput>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });

        _statusChannel = Channel.CreateBounded<SessionStatus>(new BoundedChannelOptions(2)
        {
            FullMode     = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = true,
        });

        _sessionState = StateStopped;
    }

    public async Task StartAsync(CancellationToken ct = default)
    {
        if (Interlocked.Exchange(ref _sessionState, StateRunning) == StateRunning)
            throw new InvalidOperationException("A sessão já está em execução.");

        var client = new SidecarClient(Guid.NewGuid().ToString("N"));
        _startTime = DateTime.UtcNow;
        _sessionId = client.SessionId;

        try
        {
            await client.ConnectAsync(
                _sidecarOptions.SidecarBaseUrl,
                width:                    _snapshot.Width,
                height:                   _snapshot.Height,
                initialUrl:               _snapshot.InitialUrl,
                profileBlob:              _snapshot.ProfileBlob,
                scripts:                  _snapshot.Scripts.Count > 0 ? _snapshot.Scripts : null,
                jsBridgeEnabled:          _snapshot.JsBridgeEnabled,
                allowedNavigationDomains: _snapshot.AllowedNavigationDomains,
                ct:                       ct);

            _client = client;
            _pumpFramesTask  = PumpFramesAsync(_cts.Token);
            _pumpConsoleTask = PumpConsoleOutputAsync(_cts.Token);
        }
        catch
        {
            Interlocked.Exchange(ref _sessionState, StateStopped);
            try { await client.DisposeAsync(); } catch { /* best-effort */ }
            throw;
        }
    }

    public async Task CaptureAndPersistAsync(
        string cookieId,
        IProfileSnapshotMerger merger,
        CancellationToken ct = default)
    {
        if (_client is null || string.IsNullOrWhiteSpace(cookieId)) return;

        try
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(30));

            var blob = await _client.RequestSnapshotAsync(timeoutCts.Token);
            var url  = string.IsNullOrWhiteSpace(_lastUrl) ? _snapshot.InitialUrl : _lastUrl;
            await merger.MergeAndSaveAsync(cookieId, blob, url, DateTimeOffset.UtcNow, timeoutCts.Token);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Snapshot capture failed for cookie {CookiePrefix}… — continuing teardown.",
                cookieId[..Math.Min(8, cookieId.Length)]);
        }
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

    public ChannelReader<Frame>         GetFrameReader()         => _frameChannel.Reader;
    public ChannelReader<ConsoleOutput> GetConsoleOutputReader() => _consoleOutputChannel.Reader;
    public ChannelReader<SessionStatus> GetStatusReader()        => _statusChannel.Reader;

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

    public Task NavigateAsync(string url, CancellationToken ct = default)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || uri.Scheme is not "http" and not "https")
        {
            throw new ArgumentException("URL de navegação inválida — apenas http/https são permitidos.", nameof(url));
        }

        return _client!.SendInputAsync(
            JsonSerializer.SerializeToUtf8Bytes(new { type = "navigate", url }).AsMemory(), ct);
    }

    public Task ResizeAsync(int width, int height, CancellationToken ct = default)
        => _client!.SendInputAsync(
            JsonSerializer.SerializeToUtf8Bytes(new { type = "resize", width, height }).AsMemory(), ct);

    private async Task PumpFramesAsync(CancellationToken ct)
    {
        try
        {
            await foreach (var data in _client!.VideoChannel.ReadAllAsync(ct))
            {
                if (data.IsEmpty || data.Span[0] != SidecarProtocol.MsgScreencast) continue;

                var jpegLen = data.Length - 1;
                var jpeg    = new byte[jpegLen];
                data.Span.Slice(1, jpegLen).CopyTo(jpeg);

                Interlocked.Increment(ref _frameCount);
                _frameChannel.Writer.TryWrite(new Frame
                {
                    Jpeg      = jpeg,
                    Sequence  = Interlocked.Increment(ref _frameSequence),
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

                if (raw.Span[0] == SidecarProtocol.MsgStatus)
                {
                    var status = DecodeAndAugmentStatus(raw);
                    if (status is not null)
                        _statusChannel.Writer.TryWrite(status);
                    continue;
                }

                if (raw.Span[0] is SidecarProtocol.MsgUrl
                                 or SidecarProtocol.MsgConsole
                                 or SidecarProtocol.MsgEvalResult
                                 or SidecarProtocol.MsgRedirect)
                    _consoleOutputChannel.Writer.TryWrite(new ConsoleOutput { Data = raw });
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            _consoleOutputChannel.Writer.TryComplete();
            _statusChannel.Writer.TryComplete();
        }
    }

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
        catch (OperationCanceledException) { }
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
        catch (OperationCanceledException) { }
    }

    private SessionStatus? DecodeAndAugmentStatus(ReadOnlyMemory<byte> raw)
    {
        if (raw.Length < 5) return null;
        var len = (int)BinaryPrimitives.ReadUInt32LittleEndian(raw.Span.Slice(1, 4));
        if (5 + len > raw.Length) return null;

        try
        {
            using var doc = JsonDocument.Parse(raw.Slice(5, len));
            var root = doc.RootElement;

            var now     = DateTime.UtcNow;
            var elapsed = (now - _fpsWindowStart).TotalSeconds;
            if (elapsed >= 1.0)
            {
                var count       = Interlocked.Exchange(ref _frameCount, 0);
                _lastFps        = Math.Round(count / elapsed, 1);
                _fpsWindowStart = now;
            }

            if (root.TryGetProperty("url", out var u))
                _lastUrl = u.GetString() ?? _lastUrl;

            return new SessionStatus
            {
                TabCount        = root.TryGetProperty("tabCount", out var tc) ? tc.GetInt32()     : -1,
                Url             = _lastUrl,
                Resizing        = root.TryGetProperty("resizing", out var r)  && r.GetBoolean(),
                Width           = root.TryGetProperty("width",    out var w)  ? w.GetInt32()     : 0,
                Height          = root.TryGetProperty("height",   out var h)  ? h.GetInt32()     : 0,
                Fps             = _lastFps,
                UptimeMs        = (long)(now - _startTime).TotalMilliseconds,
                SessionId       = _sessionId,
                JsBridgeEnabled = _snapshot.JsBridgeEnabled,
            };
        }
        catch { return null; }
    }
}
