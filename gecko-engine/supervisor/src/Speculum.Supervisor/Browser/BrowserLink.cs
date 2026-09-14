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
            _control = null;
            logger.LogInformation("{Frames} frames, {Bytes} bytes", frames, bytes);
        }
    }

    private void OnBrowserEvent(BrowserEvent message)
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

                var url = _contexts.TryGet(message.ContextId, out var entry) && entry.Url.Length > 0
                    ? entry.Url
                    : options.BrowserUrl;
                _ = NavigateAsync(message.ContextId, url);
                break;
            }

            case ControlOpCode.ContextDestroyed:
                _contexts.Remove(message.ContextId);
                logger.LogInformation("contexto {ContextId} destruído", message.ContextId);
                break;

            case ControlOpCode.Navigated:
                logger.LogInformation("contexto {ContextId} navegou para {Url}", message.ContextId, message.Text);
                break;

            case ControlOpCode.Fault:
                logger.LogError(
                    "browser reportou falha (contexto {ContextId}): {Reason}", message.ContextId, message.Text);
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
                _ = NavigateAsync(requested, url);
                break;
            }

            default:
                logger.LogInformation("comando de consumidor ignorado: {OpCode}", reader.OpCode);
                break;
        }
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
            var command = ControlCommand.Navigate(channel.NextId(), contextId, url);
            await channel.SendAsync(command, contextId, _sessionToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger.LogError("falha ao navegar: {Reason}", ex.Message);
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
