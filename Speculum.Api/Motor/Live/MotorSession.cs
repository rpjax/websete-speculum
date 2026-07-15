using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Motor.Diagnostics;
using Speculum.Api.Motor.Mapping;
using Speculum.Api.Motor.Sidecar;
using Speculum.Api.BrowserPersistence;
using Speculum.Api.Motor.Live.Models;

namespace Speculum.Api.Motor.Live;

public sealed class MotorSession : IMotorSession
{
    const int StateStopped = 0;
    const int StateRunning = 1;

    private readonly SidecarBrowserClientOptions _sidecarOptions;
    private readonly SessionConfigSnapshot       _snapshot;
    private readonly MotorUrlAdapter             _urlAdapter;
    private readonly ISidecarClientFactory       _sidecarClientFactory;
    private readonly IMotorDiagnosticsEmitter    _diagnostics;
    private readonly ILogger                   _logger;

    private int _sessionState;
    private ISidecarClient? _client;
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
    private string   _sidecarSessionId = "";
    private string   _currentUrl       = "";
    private string?  _persistedSessionId;
    private MotorSessionPhase _phase = MotorSessionPhase.Stopped;
    private DateTimeOffset _lastEventUtc = DateTimeOffset.UtcNow;
    private DateTimeOffset? _lastFrameUtc;
    private string? _lastNavigateResult;
    private DateTimeOffset? _lastNavigateUtc;
    private string? _lastFault;
    private int _exportingState;
    private string _connectionId = "";
    private string? _correlationId;
    private string? _clientToken;
    private int _inputAcceptedApprox;
    private int _inputForwardedApprox;
    private string _lastMappedClientUrl = "";

    public string? PersistedSessionId
    {
        get => _persistedSessionId;
        set => _persistedSessionId = value;
    }

    public string SidecarSessionId => _sidecarSessionId;

    public string? CorrelationId
    {
        get => _correlationId;
        set => _correlationId = value;
    }

    public string? ClientToken
    {
        get => _clientToken;
        set => _clientToken = value;
    }

    public string ConnectionId
    {
        get => _connectionId;
        set => _connectionId = value ?? "";
    }

    public MotorSession(
        SidecarBrowserClientOptions sidecarOptions,
        SessionConfigSnapshot       snapshot,
        MotorUrlAdapter             urlAdapter,
        ISidecarClientFactory       sidecarClientFactory,
        IMotorDiagnosticsEmitter    diagnostics,
        ILogger                     logger)
    {
        _sidecarOptions       = sidecarOptions;
        _snapshot             = snapshot;
        _urlAdapter           = urlAdapter;
        _sidecarClientFactory = sidecarClientFactory;
        _diagnostics          = diagnostics;
        _logger               = logger;
        _currentUrl           = snapshot.InitialUrl;

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

    public void MarkPhase(MotorSessionPhase phase)
    {
        _phase = phase;
        _lastEventUtc = DateTimeOffset.UtcNow;
    }

    public MotorSessionDiagnosticsSnapshot GetDiagnosticsSnapshot()
    {
        return new MotorSessionDiagnosticsSnapshot
        {
            ConnectionId = _connectionId,
            PersistedSessionId = _persistedSessionId,
            SidecarSessionId = _sidecarSessionId,
            ClientToken = _clientToken,
            CorrelationId = _correlationId,
            Phase = _phase,
            StartedAt = _startTime == default ? null : new DateTimeOffset(_startTime, TimeSpan.Zero),
            UptimeMs = _startTime == default ? 0 : (long)(DateTime.UtcNow - _startTime).TotalMilliseconds,
            LastEventUtc = _lastEventUtc,
            Fps = _lastFps,
            FrameSequence = Volatile.Read(ref _frameSequence),
            LastFrameUtc = _lastFrameUtc,
            InputQueueApprox = Math.Max(0, _inputAcceptedApprox - _inputForwardedApprox),
            FrameChannelDepth = _frameChannel.Reader.Count,
            StatusChannelDepth = _statusChannel.Reader.Count,
            CurrentUrl = _currentUrl,
            LastNavigateResult = _lastNavigateResult,
            LastNavigateUtc = _lastNavigateUtc,
            SidecarConnected = _client is not null && Volatile.Read(ref _sessionState) == StateRunning,
            LastFault = _lastFault,
            ExportingState = Volatile.Read(ref _exportingState) != 0,
            ForwardingHost = _snapshot.Forwarding?.Host,
            JsBridgeEnabled = _snapshot.JsBridgeEnabled,
            ScriptCount = _snapshot.Scripts.Count,
            AllowlistCount = _snapshot.AllowedNavigationDomains?.Length ?? 0,
            ProfileDomain = _snapshot.HostingProfile?.Domain,
        };
    }

    public async Task<object> RequestDiagnosticsProbeAsync(
        IReadOnlyList<string> ops,
        string? evaluateExpression,
        string? domSelector,
        int? maxProbeResponseBytes = null,
        CancellationToken ct = default)
    {
        if (_client is null || Volatile.Read(ref _sessionState) != StateRunning)
            throw new InvalidOperationException("session_gone");

        return await _client.RequestDiagnosticsAsync(
            ops, evaluateExpression, domSelector, maxProbeResponseBytes, ct);
    }

    public async Task StartAsync(CancellationToken ct = default)
    {
        if (Interlocked.Exchange(ref _sessionState, StateRunning) == StateRunning)
            throw new InvalidOperationException("A sessão já está em execução.");

        var client = _sidecarClientFactory.Create(Guid.NewGuid().ToString("N"));
        _startTime = DateTime.UtcNow;
        _sidecarSessionId = client.SessionId;
        MarkPhase(MotorSessionPhase.Starting);

        try
        {
            await client.ConnectAsync(
                _sidecarOptions.SidecarBaseUrl,
                width:                    _snapshot.Width,
                height:                   _snapshot.Height,
                initialUrl:               _snapshot.InitialUrl,
                browserState:             _snapshot.BrowserState,
                scripts:                  _snapshot.Scripts.Count > 0 ? _snapshot.Scripts : null,
                jsBridgeEnabled:          _snapshot.JsBridgeEnabled,
                allowedNavigationDomains: _snapshot.AllowedNavigationDomains,
                ct:                       ct);

            _client = client;
            _pumpFramesTask  = PumpFramesAsync(_cts.Token);
            _pumpConsoleTask = PumpConsoleOutputAsync(_cts.Token);
            MarkPhase(MotorSessionPhase.Running);
        }
        catch (Exception ex)
        {
            _lastFault = ex.Message;
            Interlocked.Exchange(ref _sessionState, StateStopped);
            MarkPhase(MotorSessionPhase.Stopped);
            try { await client.DisposeAsync(); } catch { /* best-effort */ }
            throw;
        }
    }

    public async Task<BrowserStatePayload?> CaptureAndPersistAsync(
        string sessionId,
        IBrowserSessionStore store,
        CancellationToken ct = default)
    {
        if (_client is null || string.IsNullOrWhiteSpace(sessionId)) return null;

        Interlocked.Exchange(ref _exportingState, 1);
        try
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(30));

            var state = await _client.RequestStateExportAsync(timeoutCts.Token);
            await store.SaveStateAsync(sessionId, state, timeoutCts.Token);
            return state;
        }
        catch (Exception ex)
        {
            _lastFault = ex.Message;
            _logger.LogWarning(ex, "State capture failed for session {SessionPrefix}… — continuing teardown.",
                sessionId[..Math.Min(8, sessionId.Length)]);
            throw;
        }
        finally
        {
            Interlocked.Exchange(ref _exportingState, 0);
        }
    }

    public async Task StopAsync(CancellationToken ct = default)
    {
        if (Interlocked.Exchange(ref _sessionState, StateStopped) == StateStopped)
            return;

        MarkPhase(MotorSessionPhase.Stopping);
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
        MarkPhase(MotorSessionPhase.Stopped);
    }

    public ChannelReader<Frame>         GetFrameReader()         => _frameChannel.Reader;
    public ChannelReader<ConsoleOutput> GetConsoleOutputReader() => _consoleOutputChannel.Reader;
    public ChannelReader<SessionStatus> GetStatusReader()        => _statusChannel.Reader;

    public Task ConsumeUserInputAsync(ChannelReader<string> channelReader)
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
            _lastNavigateResult = "failed";
            _lastNavigateUtc = DateTimeOffset.UtcNow;
            throw new ArgumentException("URL de navegação inválida — apenas http/https são permitidos.", nameof(url));
        }

        if (!SidecarInputGuard.IsNavigationUrlAllowed(url, _snapshot.AllowedNavigationDomains))
        {
            _lastNavigateResult = "rejected";
            _lastNavigateUtc = DateTimeOffset.UtcNow;
            throw new ArgumentException(
                "URL de navegação fora da allowlist de domínios configurada.",
                nameof(url));
        }

        _lastNavigateResult = "ok";
        _lastNavigateUtc = DateTimeOffset.UtcNow;
        _currentUrl = url;
        return _client!.SendInputAsync(
            JsonSerializer.SerializeToUtf8Bytes(new { type = "navigate", url }).AsMemory(), ct);
    }

    public Task ResizeAsync(int width, int height, CancellationToken ct = default)
    {
        _diagnostics.ResizeRequested(DiagnosticsContext(), width, height);

        return _client!.SendInputAsync(
            JsonSerializer.SerializeToUtf8Bytes(new { type = "resize", width, height }).AsMemory(), ct);
    }

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
                var seq = Interlocked.Increment(ref _frameSequence);
                _lastFrameUtc = DateTimeOffset.UtcNow;

                _frameChannel.Writer.TryWrite(new Frame
                {
                    Jpeg      = jpeg,
                    Sequence  = seq,
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                });
            }

            // Clean channel completion while still Running ⇒ remote sidecar death / WS drop.
            if (Volatile.Read(ref _sessionState) == StateRunning)
                PublishSidecarFault("sidecar_channel_closed");
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            PublishSidecarFault(ex.Message);
        }
        finally { _frameChannel.Writer.TryComplete(); }
    }

    private void PublishSidecarFault(string fault)
    {
        _lastFault = fault;
        _diagnostics.SidecarFaulted(DiagnosticsContext(), fault);
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
                {
                    var transformed = TransformConsoleMessage(raw);
                    _consoleOutputChannel.Writer.TryWrite(new ConsoleOutput
                    {
                        Data = transformed ?? raw,
                    });
                }
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            _consoleOutputChannel.Writer.TryComplete();
            _statusChannel.Writer.TryComplete();
        }
    }

    private ReadOnlyMemory<byte>? TransformConsoleMessage(ReadOnlyMemory<byte> raw)
    {
        if (raw.Length < 5 || raw.Span[0] != SidecarProtocol.MsgUrl)
            return null;

        var len = (int)BinaryPrimitives.ReadUInt32LittleEndian(raw.Span.Slice(1, 4));
        if (5 + len > raw.Length)
            return null;

        var targetUrl = Encoding.UTF8.GetString(raw.Span.Slice(5, len));
        var clientUrl = MapTargetUrlForClient(targetUrl);
        var clientBytes = Encoding.UTF8.GetBytes(clientUrl);

        var result = new byte[1 + 4 + clientBytes.Length];
        result[0] = SidecarProtocol.MsgUrl;
        BinaryPrimitives.WriteUInt32LittleEndian(result.AsSpan(1, 4), (uint)clientBytes.Length);
        clientBytes.CopyTo(result.AsSpan(5));
        return result;
    }

    internal string MapTargetUrlForClient(string targetUrl)
    {
        var forwarding = _snapshot.Forwarding;
        string clientUrl;
        if (forwarding is null)
        {
            clientUrl = targetUrl;
        }
        else
        {
            var profile = _snapshot.HostingProfile;
            clientUrl = profile is null
                ? _urlAdapter.EncodeTargetToClientBootstrap(
                    targetUrl, forwarding, _snapshot.MotorRequestHost)
                : _urlAdapter.EncodeTargetToClient(
                    targetUrl, profile, forwarding, _snapshot.MotorRequestHost);
        }

        MaybePublishUrlMapped(targetUrl, clientUrl);
        return clientUrl;
    }

    private void MaybePublishUrlMapped(string targetUrl, string clientUrl)
    {
        if (string.IsNullOrWhiteSpace(clientUrl))
            return;
        if (string.Equals(clientUrl, _lastMappedClientUrl, StringComparison.Ordinal))
            return;

        _lastMappedClientUrl = clientUrl;
        _diagnostics.UrlMapped(DiagnosticsContext(), targetUrl, clientUrl);
    }

    private async Task PumpUserInputAsync(ChannelReader<string> reader, CancellationToken ct)
    {
        try
        {
            await foreach (var payload in reader.ReadAllAsync(ct))
            {
                Interlocked.Increment(ref _inputAcceptedApprox);
                try
                {
                    if (!SidecarInputGuard.TryValidateUserInputPayload(payload, out var rejectReason))
                    {
                        _logger.LogWarning("Input de utilizador bloqueado: {Reason}", rejectReason);
                        continue;
                    }

                    await _client!.SendInputAsync(Encoding.UTF8.GetBytes(payload).AsMemory(), ct);
                    Interlocked.Increment(ref _inputForwardedApprox);
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
            {
                var targetUrl = u.GetString() ?? _currentUrl;
                _currentUrl = MapTargetUrlForClient(targetUrl);
            }

            _lastEventUtc = DateTimeOffset.UtcNow;

            var status = new SessionStatus
            {
                TabCount        = root.TryGetProperty("tabCount", out var tc) ? tc.GetInt32()     : -1,
                Url             = _currentUrl,
                Resizing        = root.TryGetProperty("resizing", out var r)  && r.GetBoolean(),
                Width           = root.TryGetProperty("width",    out var w)  ? w.GetInt32()     : 0,
                Height          = root.TryGetProperty("height",   out var h)  ? h.GetInt32()     : 0,
                Fps             = _lastFps,
                UptimeMs        = (long)(now - _startTime).TotalMilliseconds,
                SessionId       = _sidecarSessionId,
                JsBridgeEnabled = _snapshot.JsBridgeEnabled,
            };

            MaybeMirrorStatus(status);
            return status;
        }
        catch { return null; }
    }

    private void MaybeMirrorStatus(SessionStatus status)
        => _diagnostics.StatusMirrored(
            DiagnosticsContext(),
            status.Fps,
            status.UptimeMs,
            status.TabCount,
            status.Width,
            status.Height);

    private MotorDiagnosticsContext DiagnosticsContext()
        => new(_connectionId, _correlationId, _persistedSessionId, _sidecarSessionId);
}
