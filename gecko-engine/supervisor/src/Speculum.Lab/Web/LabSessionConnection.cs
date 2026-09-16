using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Extensions.Logging;
using Speculum.Lab.Protocol;
using Speculum.Lab.Upstream;
using Speculum.Lab.Session;
using Speculum.Supervisor.Control;
using Speculum.Supervisor.Wire;

namespace Speculum.Lab.Web;

/// <summary>
/// Uma aba do lab aberta no navegador.
///
/// Dois planos no mesmo WebSocket:
///   binário = frame opaco, repassado ao cliente projetado;
///   texto   = controle JSON (client.control encaminha ABI).
/// </summary>
public sealed class LabSessionConnection
{
    private const int OutboundCapacity = 512;
    private static readonly TimeSpan BootTimeout = TimeSpan.FromSeconds(20);

    private readonly WebSocket _socket;
    private readonly SupervisorClient _upstream;
    private readonly SessionHost _sessions;
    private readonly ILogger _logger;
    private readonly LabSessionJournal _journal = new();

    private readonly Channel<OutboundMessage> _outbound = Channel.CreateBounded<OutboundMessage>(
        new BoundedChannelOptions(OutboundCapacity)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false,
        });

    private volatile bool _streaming;
    private long _framesForwarded;
    private uint _correlation;
    private bool _capEvents;
    private bool _capMetrics;
    private bool _bootedReady;

    public long FramesForwarded => Interlocked.Read(ref _framesForwarded);

    public bool BootedReady => _bootedReady;

    public bool CapEvents => _capEvents;

    public bool CapMetrics => _capMetrics;

    public LabSessionJournal Journal => _journal;

    public LabSessionConnection(WebSocket socket, SupervisorClient upstream, SessionHost sessions, ILogger logger)
    {
        _socket = socket;
        _upstream = upstream;
        _sessions = sessions;
        _logger = logger;
        Id = Guid.NewGuid().ToString("n")[..12];
    }

    public string Id { get; }

    public bool Streaming => _streaming;

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        void OnFrame(byte[] frame)
        {
            if (!_streaming)
            {
                return;
            }

            if (_outbound.Writer.TryWrite(OutboundMessage.Binary(frame)))
            {
                Interlocked.Increment(ref _framesForwarded);
            }
            else
            {
                _journal.RecordOutboundDrop();
            }
        }

        void OnEvent(byte[] payload)
        {
            try
            {
                var reader = new ControlReader(payload);
                switch (reader.OpCode)
                {
                    case ControlOpCode.DialogRequested:
                    case ControlOpCode.PermissionRequested:
                    case ControlOpCode.DownloadRequested:
                    {
                        var ev = BrowserEvent.Decode(payload);
                        var kind = ev.OpCode switch
                        {
                            ControlOpCode.PermissionRequested => "permission",
                            ControlOpCode.DownloadRequested => "download",
                            _ => "dialog",
                        };
                        Send(new GeckoRequested(kind, ev.ContextId, (uint)ev.BrowsingContextId, ev.Text ?? ""));
                        break;
                    }
                    case ControlOpCode.ContextCreated:
                    {
                        var ev = BrowserEvent.Decode(payload);
                        Send(new GeckoContextCreated(ev.ContextId, ev.BrowsingContextId));
                        break;
                    }
                    case ControlOpCode.Navigated:
                    {
                        var ev = BrowserEvent.Decode(payload);
                        Send(new GeckoNavigated(ev.ContextId, ev.Text ?? ""));
                        break;
                    }
                    case ControlOpCode.SnapshotServed:
                    {
                        var snap = SnapshotServedPayload.Decode(payload);
                        var msg = new GeckoSnapshotServed(
                            snap.CorrelationId,
                            snap.ContextId,
                            snap.Sequence,
                            snap.Generation,
                            snap.TableHash.ToString("x16"),
                            Convert.ToBase64String(snap.Dump));
                        _journal.StoreVirtualSnapshot(msg);
                        Send(msg);
                        break;
                    }
                    case ControlOpCode.Fault:
                    {
                        var fault = FaultPayload.Decode(payload);
                        Send(new GeckoFault(
                            fault.CorrelationId,
                            fault.ContextId,
                            fault.ErrorCode,
                            fault.Phase,
                            fault.Reason));
                        break;
                    }
                }
            }
            catch (InvalidDataException ex)
            {
                _logger.LogWarning("{Id} evento ilegível: {Reason}", Id, ex.Message);
            }
        }

        void OnAsset(uint contextId, byte[] payload)
        {
            try
            {
                var decoded = DecodeAsset(payload);
                Send(new GeckoAsset(decoded.StreamId, decoded.Phase, Convert.ToBase64String(decoded.Data),
                    decoded.Phase == 2 ? Encoding.UTF8.GetString(decoded.Data) : ""));
            }
            catch (InvalidDataException ex)
            {
                _logger.LogWarning("{Id} ativo ilegível: {Reason}", Id, ex.Message);
            }
        }

        void OnTelemetry(uint contextId, byte[] payload)
        {
            var message = CatalogTelemetry.TryDecode(contextId, payload);
            if (message is null)
            {
                return;
            }

            _journal.ObserveVirtualTelemetry(message);
            Send(new LabTelemetryRelay(message));
        }

        _upstream.FrameReceived += OnFrame;
        _upstream.EventReceived += OnEvent;
        _upstream.AssetReceived += OnAsset;
        _upstream.TelemetryReceived += OnTelemetry;
        try
        {
            Send(new SessionHello(Id, Id));

            var pump = PumpOutboundAsync(cancellationToken);
            await ReceiveLoopAsync(cancellationToken).ConfigureAwait(false);
            _outbound.Writer.TryComplete();
            await pump.ConfigureAwait(false);
        }
        finally
        {
            _upstream.FrameReceived -= OnFrame;
            _upstream.EventReceived -= OnEvent;
            _upstream.AssetReceived -= OnAsset;
            _upstream.TelemetryReceived -= OnTelemetry;
            _outbound.Writer.TryComplete();
        }
    }

    private async Task ReceiveLoopAsync(CancellationToken cancellationToken)
    {
        var buffer = new byte[16 * 1024];
        using var assembled = new MemoryStream();

        while (_socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            assembled.SetLength(0);

            WebSocketReceiveResult result;
            do
            {
                result = await _socket.ReceiveAsync(buffer, cancellationToken).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    return;
                }

                assembled.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            if (result.MessageType != WebSocketMessageType.Text)
            {
                continue;
            }

            await HandleControlAsync(Encoding.UTF8.GetString(assembled.ToArray()), cancellationToken)
                .ConfigureAwait(false);
        }
    }

    private async Task HandleControlAsync(string payload, CancellationToken cancellationToken)
    {
        LabClientEnvelope? message;
        try
        {
            message = JsonSerializer.Deserialize<LabClientEnvelope>(payload, LabProtocol.Json);
        }
        catch (JsonException ex)
        {
            _logger.LogWarning("controle inválido de {Id}: {Reason}", Id, ex.Message);
            Send(new LabError("invalid JSON control message", "invalid_json"));
            return;
        }

        if (message?.Type is not { Length: > 0 } type)
        {
            Send(new LabError("missing type", "unknown_type"));
            return;
        }

        switch (type)
        {
            case "hello":
                break;

            case "browse.start":
                await BootBrowseAsync(message, cancellationToken).ConfigureAwait(false);
                break;

            case "browse.stop":
            {
                _streaming = false;
                _bootedReady = false;
                _logger.LogInformation("{Id} browse.stop", Id);
                string? dossier = null;
                if (message.ExportDossier == true)
                {
                    dossier = _journal.ExportDossier(Id, _capEvents, _capMetrics);
                }

                _sessions.Stop();
                Send(new SessionStopped(Id, "client-stop", dossier));
                break;
            }

            case "browse.navigate":
            {
                var url = message.Url ?? string.Empty;
                _logger.LogInformation("{Id} browse.navigate url={Url}", Id, url);
                if (url.Length > 0)
                {
                    var command = ControlCommand.Navigate(NextCorrelation(), contextId: 0, url);
                    _ = _upstream.SendCommandAsync(command, CancellationToken.None).AsTask();
                }

                break;
            }

            case "client.control":
            {
                if (!TryDecodeBytes(message.Bytes, out var command))
                {
                    Send(new LabError("client.control sem bytes ABI", "invalid_control"));
                    break;
                }

                _ = _upstream.SendCommandAsync(command, CancellationToken.None).AsTask();
                break;
            }

            case "client.asset":
            {
                if (!TryDecodeBytes(message.Bytes, out var assetPayload))
                {
                    Send(new LabError("client.asset sem bytes", "invalid_asset"));
                    break;
                }

                var ctx = message.ContextId ?? 0;
                var envelope = new byte[Envelope.HeaderBytes + assetPayload.Length];
                Envelope.WriteHeader(envelope, EnvelopeKind.Asset, ctx, assetPayload.Length);
                Buffer.BlockCopy(assetPayload, 0, envelope, Envelope.HeaderBytes, assetPayload.Length);
                _ = _upstream.SendCommandAsync(envelope, CancellationToken.None).AsTask();
                break;
            }

            case "client.intent":
                Send(new LabError("client.intent não entra neste fio Gecko", "intent_not_gecko"));
                break;

            case "client.resize":
            {
                var width = message.Width ?? 0;
                var height = message.Height ?? 0;
                if (width > 0 && height > 0)
                {
                    var command = ControlCommand.ViewportSet(NextCorrelation(), 0, width, height);
                    _ = _upstream.SendCommandAsync(command, CancellationToken.None).AsTask();
                }

                break;
            }

            case "client.snapshot":
            {
                if (!_bootedReady)
                {
                    _logger.LogInformation(
                        "{Id} client.snapshot ignorado — sessão ainda não booted", Id);
                    break;
                }

                var contextId = message.ContextId ?? 0;
                var corr = NextCorrelation();
                _logger.LogInformation("{Id} client.snapshot ctx={ContextId} corr={Corr}", Id, contextId, corr);
                var command = ControlCommand.Snapshot(corr, contextId);
                _ = _upstream.SendCommandAsync(command, CancellationToken.None).AsTask();
                break;
            }

            case "client.telemetry":
            {
                if (message.Message is { } tel
                    && tel.ValueKind is not JsonValueKind.Undefined and not JsonValueKind.Null)
                {
                    _journal.ObserveProjectedTelemetry(tel);
                }

                break;
            }

            case "client.snapshotResult":
            {
                _journal.StoreProjectedSnapshot(new
                {
                    contextId = message.ContextId,
                    sequence = message.Sequence,
                    generation = message.Generation,
                    desynced = message.Desynced,
                    applyError = message.ApplyError,
                    armed = message.Armed,
                    label = message.Label,
                    hasTable = message.Table is not null,
                    hasTree = message.Tree is not null,
                });
                break;
            }

            case "client.injectResult":
            case "client.tamperResult":
            case "client.validateSnaps":
            case "surface.clear":
            case "run.start":
            case "run.abort":
                break;

            case "client.requestResync":
            {
                var contextId = message.ContextId ?? 0;
                var attempt = message.Attempt ?? 1;
                var force = (byte)(attempt >= 2 ? 1 : 0);
                _logger.LogInformation(
                    "{Id} client.requestResync ctx={ContextId} attempt={Attempt} force={Force}",
                    Id,
                    contextId,
                    attempt,
                    force);
                var command = ControlCommand.Resync(NextCorrelation(), contextId, force);
                _ = _upstream.SendCommandAsync(command, CancellationToken.None).AsTask();
                break;
            }

            default:
                _logger.LogDebug("{Id} tipo de controle desconhecido: {Type}", Id, type);
                Send(new LabError($"unknown control type: {type}", "unknown_type"));
                break;
        }
    }

    private async Task BootBrowseAsync(LabClientEnvelope message, CancellationToken cancellationToken)
    {
        _streaming = true;
        _bootedReady = false;
        var url = message.Url ?? string.Empty;
        var (events, metrics) = TelemetryCapsMapper.FromBrowseStart(message.Telemetry);
        _capEvents = events;
        _capMetrics = metrics && events;

        var width = message.Width ?? 0;
        var height = message.Height ?? 0;
        _logger.LogInformation(
            "{Id} browse.start url={Url} caps.events={Events} caps.metrics={Metrics}",
            Id,
            url,
            _capEvents,
            _capMetrics);

        if (url.Length == 0)
        {
            Send(new SessionFault(Id, "browse.start sem url", "missing_url", "boot"));
            return;
        }

        var dossier = Path.Combine(
            Path.GetTempPath(),
            "speculum-lab-runs",
            $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Id}");
        Directory.CreateDirectory(dossier);
        _journal.DossierDir = dossier;

        await _sessions.StartAsync(
            new SessionLaunchParams
            {
                Url = url,
                ViewportWidth = width,
                ViewportHeight = height,
                CapEvents = _capEvents,
                CapMetrics = _capMetrics,
                DossierDir = dossier,
            },
            cancellationToken).ConfigureAwait(false);

        if (!_sessions.Running)
        {
            Send(new SessionFault(Id, "supervisor não iniciou", "supervisor_start_failed", "boot"));
            return;
        }

        var deadline = DateTime.UtcNow + BootTimeout;
        while (!_upstream.Connected && DateTime.UtcNow < deadline)
        {
            if (!_sessions.Running)
            {
                Send(new SessionFault(Id, "supervisor morreu no boot", "supervisor_exited", "boot"));
                return;
            }

            await Task.Delay(100, cancellationToken).ConfigureAwait(false);
        }

        if (!_upstream.Connected)
        {
            Send(new SessionFault(Id, "timeout esperando supervisor WS", "supervisor_connect_timeout", "boot"));
            return;
        }

        _bootedReady = true;
        Send(new SessionBooted(Id, "browse", url, dossier, _capEvents, _capMetrics));
        Send(new LabStats(_journal.Stats(_capEvents, _capMetrics)));

        // Pedir snapshot projected ao client assim que a superfície existir (F5).
        Send(new RequestSnapshotHost(1));
    }

    private uint NextCorrelation() => Interlocked.Increment(ref _correlation);

    internal static bool TryDecodeBytes(string? base64, out byte[] bytes)
    {
        bytes = [];
        if (string.IsNullOrWhiteSpace(base64))
        {
            return false;
        }

        try
        {
            bytes = Convert.FromBase64String(base64);
            return bytes.Length > 0;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static (uint StreamId, byte Phase, byte[] Data) DecodeAsset(byte[] payload)
    {
        if (payload.Length < 17)
        {
            throw new InvalidDataException("asset curto");
        }

        var streamId = BitConverter.ToUInt32(payload, 0);
        var phase = payload[4];
        var len = checked((int)BitConverter.ToUInt32(payload, 13));
        if (payload.Length < 17 + len)
        {
            throw new InvalidDataException("asset truncado");
        }

        var data = new byte[len];
        Buffer.BlockCopy(payload, 17, data, 0, len);
        return (streamId, phase, data);
    }

    private async Task PumpOutboundAsync(CancellationToken cancellationToken)
    {
        try
        {
            await foreach (var message in _outbound.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
            {
                if (_socket.State != WebSocketState.Open)
                {
                    return;
                }

                await _socket
                    .SendAsync(message.Payload, message.Type, endOfMessage: true, cancellationToken)
                    .ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (WebSocketException ex)
        {
            _logger.LogInformation("{Id} caiu: {Reason}", Id, ex.Message);
        }
    }

    private void Send<T>(T message)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(message, LabProtocol.Json);
        if (!_outbound.Writer.TryWrite(OutboundMessage.Text(json)))
        {
            _journal.RecordOutboundDrop();
        }
    }

    private readonly record struct OutboundMessage(WebSocketMessageType Type, ReadOnlyMemory<byte> Payload)
    {
        public static OutboundMessage Text(byte[] payload) => new(WebSocketMessageType.Text, payload);

        public static OutboundMessage Binary(byte[] payload) => new(WebSocketMessageType.Binary, payload);
    }
}
