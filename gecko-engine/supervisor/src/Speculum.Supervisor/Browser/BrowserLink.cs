using System.Net.Sockets;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Speculum.Supervisor.Consumers;
using Speculum.Supervisor.Control;
using Speculum.Supervisor.Wire;

namespace Speculum.Supervisor.Browser;

/// <summary>
/// A sessão: o supervisor abre o socket, sobe o browser, recebe a conexão dele,
/// repassa os frames aos consumidores e morre junto com ele.
///
/// Um supervisor, um browser, uma vida. Sem opção que mude isso — se houvesse,
/// o lab estaria exercitando um supervisor que não é o de produção.
/// </summary>
public sealed class BrowserLink(
    SupervisorOptions options,
    ConsumerHub consumers,
    IHostApplicationLifetime lifetime,
    ILogger<BrowserLink> logger) : BackgroundService
{
    private readonly ContextTable _contexts = new();
    private ControlChannel? _control;
    private CancellationToken _sessionToken;
    /// <summary>
    /// Root document commit (Navigated) completed. Resync before this dumps about:blank;
    /// resync on every consumer attach + every Navigated duplicates wholesale rebuilds
    /// and collides with the live tick stream (Eneba/Beleza-class desync storms).
    /// </summary>
    private bool _rootNavigationCommitted;
    /// <summary>One wholesale resync per navigation intent — not every redirect Navigated.</summary>
    private bool _awaitingRootNavigatedResync;

    /// <summary>Última URL de Navigated na raiz — follow-on (challenge→loja) também resynca.</summary>
    private string _lastRootNavigatedUrl = "";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        PrepareSocketPath(options.BrowserSocketPath);

        using var listener = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        listener.Bind(new UnixDomainSocketEndPoint(options.BrowserSocketPath));
        listener.Listen(backlog: 1);

        using var browser = new BrowserProcess(options, logger);

        try
        {
            // O supervisor sobe o browser e espera a PONTE DE CONTROLE — não um
            // consumidor (doc 17 §1). Consumidor que chega depois do bootstrap se
            // resolve com resync, não atrasando o lançamento.
            browser.Start();

            // Ou o browser conecta, ou ele morre antes de conectar. Esperar só
            // pelo accept deixaria o supervisor pendurado num filho morto.
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
            // encerramento normal
        }
        catch (Exception ex)
        {
            logger.LogError("sessão falhou: {Reason}", ex.Message);
        }
        finally
        {
            browser.Stop();
            TryDeleteSocketPath(options.BrowserSocketPath);

            // Doc 15 — caiu = morre. A sessão acabou; o supervisor acabou.
            logger.LogInformation("sessão encerrada — supervisor saindo");
            lifetime.StopApplication();
        }
    }

    private async Task ServeBrowserAsync(Socket socket, CancellationToken cancellationToken)
    {
        logger.LogInformation("browser conectado");

        await using var stream = new NetworkStream(socket, ownsSocket: false);
        var reader = new EnvelopeReader(stream);
        await using var writer = new EnvelopeWriter(stream);
        var control = new ControlChannel(writer, logger);
        _control = control;
        _sessionToken = cancellationToken;
        control.EventReceived += OnBrowserEvent;
        consumers.CommandReceived += OnConsumerCommand;
        consumers.ConsumerAttached += OnConsumerAttached;
        consumers.AssetFromConsumer += OnAssetFromConsumer;

        var frames = 0L;
        var bytes = 0L;

        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var message = await reader.ReadAsync(cancellationToken).ConfigureAwait(false);
                if (message is null)
                {
                    logger.LogInformation("browser fechou a conexão");
                    break;
                }

                switch (message.Value.Kind)
                {
                    case EnvelopeKind.Hello:
                        logger.LogInformation("browser apresentou-se");
                        break;

                    case EnvelopeKind.Frame:
                        frames++;
                        bytes += message.Value.Payload.Length;
                        consumers.Broadcast(message.Value.ContextId, message.Value.Payload);
                        break;

                    case EnvelopeKind.BrowserEvent:
                        control.Receive(message.Value.Payload);
                        break;

                    case EnvelopeKind.Telemetry:
                    case EnvelopeKind.Asset:
                        consumers.BroadcastEnvelope(
                            message.Value.Kind, message.Value.ContextId, message.Value.Payload);
                        break;

                    default:
                        logger.LogWarning("envelope desconhecido do browser: {Kind}", message.Value.Kind);
                        break;
                }
            }
        }
        catch (OperationCanceledException)
        {
            // encerramento normal
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
            control.EventReceived -= OnBrowserEvent;
            consumers.CommandReceived -= OnConsumerCommand;
            consumers.ConsumerAttached -= OnConsumerAttached;
            consumers.AssetFromConsumer -= OnAssetFromConsumer;
            _control = null;
            logger.LogInformation("{Frames} frames, {Bytes} bytes", frames, bytes);
        }
    }

    private void OnBrowserEvent(BrowserEvent message, byte[] payload)
    {
        switch (message.OpCode)
        {
            case ControlOpCode.Ready:
                logger.LogInformation("browser pronto — pedindo o contexto da sessão");
                _ = RequestContextAsync();
                break;

            case ControlOpCode.ContextCreated:
            {
                _contexts.MarkCreated(message.ContextId, message.BrowsingContextId);
                logger.LogInformation(
                    "contexto {ContextId} criado (browsingContext {Bc})",
                    message.ContextId,
                    message.BrowsingContextId);
                consumers.BroadcastEnvelope(EnvelopeKind.BrowserEvent, message.ContextId, payload);

                var url = _contexts.TryGet(message.ContextId, out var entry) && entry.Url.Length > 0
                    ? entry.Url
                    : options.BrowserUrl;
                MarkRootNavigationPending(message.ContextId);
                logger.LogInformation(
                    "Navigate frio após ContextCreated ctx={ContextId} url={Url}",
                    message.ContextId,
                    url);
                _ = NavigateAsync(message.ContextId, url);
                break;
            }

            case ControlOpCode.ContextDestroyed:
                if (_contexts.TryGetRoot(out var destroyed) && destroyed.ContextId == message.ContextId)
                {
                    _rootNavigationCommitted = false;
                }
                _contexts.Remove(message.ContextId);
                logger.LogInformation("contexto {ContextId} destruído", message.ContextId);
                break;

            case ControlOpCode.Navigated:
                logger.LogInformation("contexto {ContextId} navegou para {Url}", message.ContextId, message.Text);
                // Consumidor precisa ver a URL commitada (oráculo de estado / lab).
                consumers.BroadcastEnvelope(EnvelopeKind.BrowserEvent, message.ContextId, payload);
                // O resync no ContextCreated dumpava about:blank. A tabela viva
                // só existe depois do Navigate ter commitado.
                if (_contexts.TryGetRoot(out var rootNav) && rootNav.ContextId == message.ContextId)
                {
                    _rootNavigationCommitted = true;
                    var url = message.Text ?? "";
                    var urlChanged = !string.Equals(url, _lastRootNavigatedUrl, StringComparison.Ordinal);
                    _lastRootNavigatedUrl = url;
                    if (consumers.Count > 0 &&
                        (_awaitingRootNavigatedResync || urlChanged))
                    {
                        _awaitingRootNavigatedResync = false;
                        _ = ResyncAsync(message.ContextId);
                    }
                }
                else if (consumers.Count > 0)
                {
                    _ = ResyncAsync(message.ContextId);
                }
                break;

            case ControlOpCode.Fault:
                logger.LogError(
                    "browser reportou falha (contexto {ContextId}): {Reason}", message.ContextId, message.Text);
                break;

            case ControlOpCode.SnapshotServed:
            case ControlOpCode.DialogRequested:
            case ControlOpCode.PermissionRequested:
            case ControlOpCode.DownloadRequested:
                consumers.BroadcastEnvelope(EnvelopeKind.BrowserEvent, message.ContextId, payload);
                break;

            default:
                break;
        }
    }

    /// <summary>
    /// Comando vindo de um consumidor. O supervisor é a interface: o consumidor
    /// pede, o supervisor comanda, e o contextId é atribuído aqui — nunca pelo
    /// consumidor nem pelo C++.
    /// </summary>
    private void OnConsumerCommand(byte[] payload)
    {
        ControlReader reader;
        try
        {
            reader = new ControlReader(payload);
        }
        catch (InvalidDataException ex)
        {
            logger.LogWarning("comando de consumidor ilegível: {Reason}", ex.Message);
            return;
        }

        switch (reader.OpCode)
        {
            case ControlOpCode.Navigate:
            {
                var requested = reader.ReadUInt32();
                var url = reader.ReadString();

                // contextId 0 do consumidor significa "o contexto raiz da sessão".
                // Quem resolve isso é o supervisor, porque ele é quem nomeia.
                if (requested == 0 && _contexts.TryGetRoot(out var root))
                {
                    requested = root.ContextId;
                }

                if (requested == 0)
                {
                    logger.LogWarning("navegação pedida sem contexto existente; ignorada");
                    break;
                }

                logger.LogInformation("consumidor pediu navegação do contexto {ContextId} para {Url}", requested, url);
                MarkRootNavigationPending(requested);
                _ = NavigateAsync(requested, url);
                break;
            }

            case ControlOpCode.Resync:
            {
                var requested = reader.ReadUInt32();
                var force = reader.ReadUInt8();
                if (requested == 0 && _contexts.TryGetRoot(out var root))
                {
                    requested = root.ContextId;
                }

                if (requested == 0)
                {
                    logger.LogWarning("resync pedido sem contexto existente; ignorado");
                    break;
                }

                logger.LogInformation("consumidor pediu resync do contexto {ContextId} força={Force}", requested, force);
                _ = ResyncAsync(requested, force);
                break;
            }

            case ControlOpCode.HaltClocks:
                _ = SendRawAsync(ControlCommand.HaltClocks(_control?.NextId() ?? 0), 0);
                break;

            case ControlOpCode.ResumeClocks:
                _ = SendRawAsync(ControlCommand.ResumeClocks(_control?.NextId() ?? 0), 0);
                break;

            case ControlOpCode.FlushFrame:
            case ControlOpCode.Snapshot:
            case ControlOpCode.Input:
            case ControlOpCode.ViewportSet:
            case ControlOpCode.HistoryGo:
            case ControlOpCode.Reload:
            case ControlOpCode.Stop:
            case ControlOpCode.DialogRespond:
            case ControlOpCode.PermissionRespond:
            case ControlOpCode.DownloadRespond:
            {
                var requested = reader.ReadUInt32();
                if (requested == 0 && _contexts.TryGetRoot(out var root))
                {
                    requested = root.ContextId;
                }

                if (requested == 0)
                {
                    logger.LogWarning("comando {OpCode} sem contexto; ignorado", reader.OpCode);
                    break;
                }

                _ = SendRawAsync(RewriteContext(payload, requested), requested);
                break;
            }

            default:
                logger.LogInformation("comando de consumidor ignorado: {OpCode}", reader.OpCode);
                break;
        }
    }

    private async Task SendRawAsync(byte[] command, uint contextId)
    {
        var channel = _control;
        if (channel is null)
        {
            return;
        }

        try
        {
            await channel.SendAsync(command, contextId, _sessionToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger.LogError("falha ao encaminhar comando: {Reason}", ex.Message);
        }
    }

    private void OnAssetFromConsumer(uint contextId, byte[] payload)
    {
        var channel = _control;
        if (channel is null)
        {
            return;
        }

        var ctx = contextId;
        if (ctx == 0 && _contexts.TryGetRoot(out var root))
        {
            ctx = root.ContextId;
        }

        _ = channel.SendKindAsync(EnvelopeKind.Asset, ctx, payload, _sessionToken);
    }

    private static byte[] RewriteContext(byte[] payload, uint contextId)
    {
        var copy = (byte[])payload.Clone();
        if (copy.Length >= ControlWriter.HeaderBytes + sizeof(uint))
        {
            System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(
                copy.AsSpan(ControlWriter.HeaderBytes), contextId);
        }

        return copy;
    }

    private async Task RequestContextAsync()
    {
        var channel = _control;
        if (channel is null)
        {
            return;
        }

        try
        {
            var contextId = _contexts.Allocate(options.BrowserUrl);
            var command = ControlCommand.ContextCreate(
                channel.NextId(), contextId, options.ViewportWidth, options.ViewportHeight);
            await channel.SendAsync(command, contextId, _sessionToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger.LogError("falha ao pedir contexto: {Reason}", ex.Message);
        }
    }

    private async Task NavigateAsync(uint contextId, string url)
    {
        var channel = _control;
        if (channel is null)
        {
            return;
        }

        try
        {
            var correlationId = channel.NextId();
            logger.LogInformation(
                "Navigate enviado corr={CorrelationId} ctx={ContextId} url={Url}",
                correlationId,
                contextId,
                url);
            var command = ControlCommand.Navigate(correlationId, contextId, url);
            await channel.SendAsync(command, contextId, _sessionToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger.LogError("falha ao navegar: {Reason}", ex.Message);
        }
    }

    private void OnConsumerAttached()
    {
        // Late attach: consumer missed the Navigated resync — one wholesale map now.
        // Before root commit, Navigated will resync; skip about:blank dump here.
        if (!_rootNavigationCommitted)
        {
            return;
        }

        if (_contexts.TryGetRoot(out var root) && root.BrowsingContextId != 0)
        {
            _ = ResyncAsync(root.ContextId);
        }
    }

    private void MarkRootNavigationPending(uint contextId)
    {
        if (_contexts.TryGetRoot(out var root) && root.ContextId == contextId)
        {
            _rootNavigationCommitted = false;
            _awaitingRootNavigatedResync = true;
            _lastRootNavigatedUrl = "";
        }
    }

    private async Task ResyncAsync(uint contextId, byte force = 0)
    {
        var channel = _control;
        if (channel is null)
        {
            return;
        }

        try
        {
            var command = ControlCommand.Resync(channel.NextId(), contextId, force);
            await channel.SendAsync(command, contextId, _sessionToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger.LogError("falha ao pedir resync: {Reason}", ex.Message);
        }
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
            // socket órfão de outra execução; o bind falha com mensagem clara
        }
    }
}
