using System.Net.Sockets;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Speculum.Supervisor.Consumers;
using Speculum.Supervisor.Control;
using Speculum.Supervisor.Wire;
using Speculum.Wire;

namespace Speculum.Supervisor.Browser;

/// <summary>
/// Session: supervisor opens the socket, starts the browser, speaks schema wire
/// (16-byte envelope + generated payloads). No Kind/ControlAbi.
/// </summary>
public sealed class BrowserLink(
    SupervisorOptions options,
    ConsumerHub consumers,
    IHostApplicationLifetime lifetime,
    ILogger<BrowserLink> logger) : BackgroundService
{
    private readonly ContextTable _contexts = new();
    private SchemaControlChannel? _control;
    private CancellationToken _sessionToken;
    private bool _rootNavigationCommitted;
    private bool _attachResyncServed;
    private uint _rootViewport;
    private readonly TaskCompletionSource _consumerPresent =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        PrepareSocketPath(options.BrowserSocketPath);

        using var listener = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        listener.Bind(new UnixDomainSocketEndPoint(options.BrowserSocketPath));
        listener.Listen(backlog: 1);

        using var browser = new BrowserProcess(options, logger);

        try
        {
            browser.Start();

            var accept = listener.AcceptAsync(stoppingToken).AsTask();
            var finished = await Task.WhenAny(accept, browser.Exited).ConfigureAwait(false);
            if (finished != accept)
            {
                logger.LogError("browser morreu antes de se conectar");
                return;
            }

            using var connection = await accept.ConfigureAwait(false);
            await ServeBrowserAsync(connection, stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            logger.LogError("sessão falhou: {Reason}", ex.Message);
        }
        finally
        {
            browser.Stop();
            TryDeleteSocketPath(options.BrowserSocketPath);
            logger.LogInformation("sessão encerrada — supervisor saindo");
            lifetime.StopApplication();
        }
    }

    private async Task ServeBrowserAsync(System.Net.Sockets.Socket socket, CancellationToken cancellationToken)
    {
        logger.LogInformation("browser conectado");

        await using var stream = new NetworkStream(socket, ownsSocket: false);
        var reader = new SchemaEnvelopeReader(stream);
        await using var writer = new SchemaLinkWriter(stream);
        var control = new SchemaControlChannel(writer, logger);
        _control = control;
        _sessionToken = cancellationToken;
        control.MessageReceived += OnMotorMessage;
        control.FaultReceived += OnFault;
        consumers.CommandReceived += OnConsumerCommand;
        consumers.ConsumerAttached += OnConsumerAttached;
        consumers.LastConsumerLeft += OnLastConsumerLeft;
        consumers.AssetFromConsumer += OnAssetFromConsumer;

        var frames = 0L;
        var bytes = 0L;

        try
        {
            // Schema Ready from motor starts the session vocabulary.
            while (!cancellationToken.IsCancellationRequested)
            {
                var message = await reader.ReadAsync(cancellationToken).ConfigureAwait(false);
                if (message is null)
                {
                    logger.LogInformation("browser fechou a conexão");
                    break;
                }

                var msg = message.Value;
                if (msg.Opcode == OpPatch.Code)
                {
                    frames++;
                    bytes += msg.Payload.Length;
                    consumers.BroadcastSchema(msg.Opcode, msg.Target, msg.Payload, msg.Correlation);
                    continue;
                }

                control.Receive(msg.Opcode, msg.Target, msg.Correlation, msg.Payload);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (IOException ex)
        {
            logger.LogWarning("ponte com o browser rompeu: {Reason}", ex.Message);
        }
        catch (InvalidDataException ex)
        {
            logger.LogError("protocolo violado pelo browser: {Reason}", ex.Message);
        }
        finally
        {
            control.MessageReceived -= OnMotorMessage;
            control.FaultReceived -= OnFault;
            consumers.CommandReceived -= OnConsumerCommand;
            consumers.ConsumerAttached -= OnConsumerAttached;
            consumers.LastConsumerLeft -= OnLastConsumerLeft;
            consumers.AssetFromConsumer -= OnAssetFromConsumer;
            _control = null;
            logger.LogInformation("{Frames} patches, {Bytes} bytes", frames, bytes);
        }
    }

    private void OnFault(Fault fault)
    {
        if (!FaultDispatcher.IsCatalogued(fault.code))
        {
            logger.LogError("Fault com código fora do catálogo: {Code}", (ushort)fault.code);
            return;
        }

        logger.LogError(
            "Fault tipado code={Code} origin={Origin} message={Message}",
            fault.code,
            fault.origin,
            fault.message);
        consumers.BroadcastSchema(
            OpFault.Code, 0, Codecs.EncodeFaultBytes(fault));
    }

    private void OnMotorMessage(ushort opcode, uint target, uint correlation, byte[] payload)
    {
        consumers.BroadcastSchema(opcode, target, payload, correlation);

        if (opcode == OpReady.Code)
        {
            logger.LogInformation("motor Ready — abrindo viewport");
            _ = OpenSessionAsync();
            return;
        }

        if (opcode == OpViewportOpened.Code)
        {
            _rootViewport = target;
            var hostId = _contexts.Allocate(options.BrowserUrl);
            _contexts.MarkCreated(hostId, target);
            logger.LogInformation("ViewportOpened target={Target} host={Host}", target, hostId);
            _ = NavigateRootAsync(target);
            return;
        }

        if (opcode == OpDocumentInstalled.Code || opcode == OpLoadStateChanged.Code)
        {
            if (target == _rootViewport)
            {
                _rootNavigationCommitted = true;
            }
        }
    }

    private void OnConsumerCommand(byte[] payload)
    {
        if (payload.Length < SchemaEnvelope.HeaderBytes)
        {
            return;
        }

        ushort opcode;
        uint target;
        uint correlation;
        byte[] body;
        try
        {
            var (op, tgt, len, corr) = SchemaEnvelope.ReadHeader(payload);
            opcode = op;
            target = tgt;
            correlation = corr;
            body = new byte[len];
            Buffer.BlockCopy(payload, SchemaEnvelope.HeaderBytes, body, 0, len);
        }
        catch (Exception ex)
        {
            logger.LogWarning("comando de consumidor ilegível: {Reason}", ex.Message);
            return;
        }

        if (target == 0 && _rootViewport != 0)
        {
            target = _rootViewport;
        }

        var channel = _control;
        if (channel is null)
        {
            return;
        }

        _ = channel.SendAsync(opcode, target, body, correlation == 0 ? channel.NextId() : correlation, _sessionToken);
    }

    private async Task OpenSessionAsync()
    {
        var channel = _control;
        if (channel is null)
        {
            return;
        }

        try
        {
            var corr = channel.NextId();
            await channel.SendViewportOpenAsync(
                    0,
                    new Extent { width = (ushort)options.ViewportWidth, height = (ushort)options.ViewportHeight },
                    corr,
                    _sessionToken)
                .ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger.LogError("falha ao abrir viewport: {Reason}", ex.Message);
        }
    }

    private async Task NavigateRootAsync(uint viewportTarget)
    {
        var channel = _control;
        if (channel is null)
        {
            return;
        }

        try
        {
            // Brief wait so a consumer that connects on listen does not miss the Navigate Patch.
            // If nobody attaches in time, navigate anyway (headless / no client).
            if (consumers.Count == 0)
            {
                await Task.WhenAny(_consumerPresent.Task, Task.Delay(3000, _sessionToken))
                    .ConfigureAwait(false);
            }

            MarkRootNavigationPending(viewportTarget);
            await channel.SendNavigateAsync(viewportTarget, options.BrowserUrl, channel.NextId(), _sessionToken)
                .ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger.LogError("falha ao navegar: {Reason}", ex.Message);
        }
    }

    private void OnConsumerAttached()
    {
        _consumerPresent.TrySetResult();

        if (!_rootNavigationCommitted || _attachResyncServed)
        {
            return;
        }

        if (_rootViewport == 0)
        {
            return;
        }

        _attachResyncServed = true;
        var channel = _control;
        if (channel is null)
        {
            return;
        }

        var force = channel.Policy.ChooseResyncForce();
        _ = channel.SendResyncAsync(_rootViewport, force, channel.NextId(), _sessionToken);
    }

    private void MarkRootNavigationPending(uint target)
    {
        if (target == _rootViewport || _rootViewport == 0)
        {
            _rootNavigationCommitted = false;
            _attachResyncServed = false;
        }
    }

    private void OnAssetFromConsumer(uint target, byte[] payload)
    {
        var channel = _control;
        if (channel is null)
        {
            return;
        }

        var ctx = target == 0 ? _rootViewport : target;
        _ = channel.SendAsync(OpAssetRequest.Code, ctx, payload, channel.NextId(), _sessionToken);
    }

    private void OnLastConsumerLeft()
    {
        logger.LogInformation("último consumidor saiu — supervisor+browser encerrando");
        var channel = _control;
        if (channel is not null)
        {
            _ = channel.SendShutdownAsync(channel.NextId(), CancellationToken.None);
        }

        lifetime.StopApplication();
    }

    private static void PrepareSocketPath(string path)
    {
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        TryDeleteSocketPath(path);
    }

    private static void TryDeleteSocketPath(string path)
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
