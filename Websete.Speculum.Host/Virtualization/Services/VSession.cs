using System.Threading.Channels;

namespace Websete.Speculum.Host.Virtualization.Services;

/*
 * Refactor — WIP
 */
public class VSession : IVirtualizationSession2
{
    // ── Estado ────────────────────────────────────────────────────────────────

    const int StateStopped = 0;
    const int StateRunning = 1;

    // ── Dependências ──────────────────────────────────────────────────────────

    private readonly IDownstreamConnection     _downstreamConnection;
    private readonly IVirtualBrowserConnection _virtualBrowserConnection;

    // Vídeo
    private readonly IFrameSource _frameSource;
    private readonly IFrameSink   _frameSink;

    // Input do usuário
    private readonly IInputSource _inputSource;
    private readonly IInputSink   _inputSink;

    // Controle — URL updates, navegação (navegador virtual → cliente)
    private readonly IControlSource _controlSource;
    private readonly IControlSink   _controlSink;

    // JsBridge — console JS (evaljs + logs)
    private readonly IJsConsoleInputSource  _consoleInputSource;
    private readonly IJsConsoleInputSink    _consoleInputSink;
    private readonly IJsConsoleOutputSource _consoleOutputSource;
    private readonly IJsConsoleOutputSink   _consoleOutputSink;

    private readonly ILogger _logger;

    // ── Estado interno ────────────────────────────────────────────────────────

    private readonly CancellationTokenSource _cancellationSource;
    private          int                     _sessionState;

    // ── Tasks de plano de fundo ───────────────────────────────────────────────

    private Task? _frameStreamingTask;
    private Task? _controlStreamingTask;
    private Task? _inputProcessingTask;
    private Task? _consoleInputProcessingTask;
    private Task? _consoleOutputStreamingTask;

    // ── Construtor ────────────────────────────────────────────────────────────

    public VSession(
        IDownstreamConnection     downstreamConnection,
        IVirtualBrowserConnection virtualBrowserConnection,
        IFrameSource              frameSource,
        IFrameSink                frameSink,
        IControlSource            controlSource,
        IControlSink              controlSink,
        IInputSource              inputSource,
        IInputSink                inputSink,
        IJsConsoleInputSource     consoleInputSource,
        IJsConsoleInputSink       consoleInputSink,
        IJsConsoleOutputSource    consoleOutputSource,
        IJsConsoleOutputSink      consoleOutputSink,
        ILogger                   logger)
    {
        _downstreamConnection     = downstreamConnection;
        _virtualBrowserConnection = virtualBrowserConnection;
        _frameSource              = frameSource;
        _frameSink                = frameSink;
        _controlSource            = controlSource;
        _controlSink              = controlSink;
        _inputSource              = inputSource;
        _inputSink                = inputSink;
        _consoleInputSource       = consoleInputSource;
        _consoleInputSink         = consoleInputSink;
        _consoleOutputSource      = consoleOutputSource;
        _consoleOutputSink        = consoleOutputSink;
        _logger                   = logger;

        _cancellationSource = new CancellationTokenSource();
        _sessionState       = StateStopped;
    }

    // ── Ciclo de vida ─────────────────────────────────────────────────────────

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _cancellationSource.Dispose();
        GC.SuppressFinalize(this);
    }

    public Task StartAsync(CancellationToken ct = default)
    {
        if (Interlocked.Exchange(ref _sessionState, StateRunning) == StateRunning)
            throw new InvalidOperationException("A sessão já está em execução.");

        // linkedCts: guarda de agendamento (segundo arg de Task.Run) — impede
        // que as tasks sejam enfileiradas se ct já estiver cancelado.
        // O corpo dos loops usa _cancellationSource.Token (vida da sessão).
        // 'using' descarta o handle imediatamente após o agendamento.
        using var linkedCts   = CancellationTokenSource.CreateLinkedTokenSource(ct, _cancellationSource.Token);
        var       schedulerCt = linkedCts.Token;
        var       sessionCt   = _cancellationSource.Token;

        _frameStreamingTask = Task.Run(() => ForwardPipelineAsync(
            "frames",
            _frameSource.GetFrameReader(),
            (frame, ct) => _frameSink.WriteFrameAsync(frame, ct),
            failFast: true,
            sessionCt), schedulerCt);

        _controlStreamingTask = Task.Run(() => ForwardPipelineAsync(
            "control",
            _controlSource.GetControlEventReader(),
            (ev, ct) => _controlSink.WriteControlEventAsync(ev, ct),
            failFast: true,
            sessionCt), schedulerCt);

        _inputProcessingTask = Task.Run(() => ForwardPipelineAsync(
            "input",
            _inputSource.GetInputEventReader(),
            (ev, ct) => _inputSink.WriteInputEventAsync(ev, ct),
            failFast: false,
            sessionCt), schedulerCt);

        _consoleInputProcessingTask = Task.Run(() => ForwardPipelineAsync(
            "console-input",
            _consoleInputSource.GetConsoleInputReader(),
            (ev, ct) => _consoleInputSink.WriteConsoleInputAsync(ev, ct),
            failFast: false,
            sessionCt,
            itemContext: ev => $" EvalId={ev.Id}"), schedulerCt);

        _consoleOutputStreamingTask = Task.Run(() => ForwardPipelineAsync(
            "console-output",
            _consoleOutputSource.GetConsoleOutputReader(),
            (ev, ct) => _consoleOutputSink.WriteConsoleOutputAsync(ev, ct),
            failFast: true,
            sessionCt), schedulerCt);

        return Task.CompletedTask;
    }

    public async Task StopAsync()
    {
        if (Interlocked.Exchange(ref _sessionState, StateStopped) == StateStopped)
            return; // Previne reentrância caso StopAsync seja disparado em paralelo

        _logger.LogInformation("Finalizando sessão de virtualização...");

        try
        {
            await _cancellationSource.CancelAsync();
        }
        catch (Exception ex)
        {
            _logger.LogCritical(ex, "Erro ao disparar sinal de cancelamento da sessão.");
        }

        var backgroundTasks = new List<Task>(5);
        if (_frameStreamingTask         is { } ft)  backgroundTasks.Add(ft);
        if (_controlStreamingTask       is { } ctrl) backgroundTasks.Add(ctrl);
        if (_inputProcessingTask        is { } it)  backgroundTasks.Add(it);
        if (_consoleInputProcessingTask is { } ci)  backgroundTasks.Add(ci);
        if (_consoleOutputStreamingTask is { } co)  backgroundTasks.Add(co);

        if (backgroundTasks.Count > 0)
        {
            try
            {
                await Task.WhenAll(backgroundTasks);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Ocorreu uma falha ao encerrar as tarefas de plano de fundo da sessão.");
            }
        }

        await CloseConnectionsAsync();
    }

    // ── Pipeline unificado de forwarding ─────────────────────────────────────

    /// <summary>
    /// Loop genérico de forwarding: drena <paramref name="reader"/> e despacha
    /// cada item via <paramref name="writer"/>.
    /// </summary>
    /// <param name="pipelineName">Nome usado nos logs.</param>
    /// <param name="reader">Canal de origem.</param>
    /// <param name="writer">Delegate de escrita no destino.</param>
    /// <param name="failFast">
    ///   <c>true</c>: qualquer falha de escrita encerra o loop (ex: vídeo,
    ///   console-output — colapso do canal downstream é irrecuperável).<br/>
    ///   <c>false</c>: falhas isoladas são toleradas com <c>continue</c>
    ///   (ex: input de mouse, evaljs — degradação parcial aceitável).
    /// </param>
    /// <param name="ct">Token de cancelamento da sessão.</param>
    /// <param name="itemContext">
    ///   Delegate opcional que extrai contexto diagnóstico do item para o log
    ///   de erro (ex: <c>ev => $" EvalId={ev.Id}"</c>).
    /// </param>
    private async Task ForwardPipelineAsync<T>(
        string                           pipelineName,
        ChannelReader<T>                 reader,
        Func<T, CancellationToken, Task> writer,
        bool                             failFast,
        CancellationToken                ct,
        Func<T, string>?                 itemContext = null)
    {
        try
        {
            await foreach (var item in reader.ReadAllAsync(ct))
            {
                try
                {
                    await writer(item, ct);
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex)
                {
                    var ctx = itemContext?.Invoke(item) ?? string.Empty;
                    _logger.LogError(ex, "Falha no pipeline '{Name}'{Context}.", pipelineName, ctx);
                    if (failFast) break;
                    else          continue;
                }
            }
        }
        catch (OperationCanceledException) { /* cancelamento limpo via token da sessão */ }
        catch (Exception ex)
        {
            _logger.LogCritical(ex, "Falha crítica não tratada no pipeline '{Name}'.", pipelineName);
        }
        finally
        {
            _logger.LogInformation("Loop do pipeline '{Name}' encerrado.", pipelineName);
        }
    }

    // ── Teardown das conexões externas ────────────────────────────────────────

    private async Task CloseConnectionsAsync()
    {
        await Task.WhenAll(
            TryCloseAsync("downstream",      () => _downstreamConnection.CloseAsync()),
            TryCloseAsync("virtual browser", () => _virtualBrowserConnection.StopAsync()));
    }

    private async Task TryCloseAsync(string label, Func<Task> action)
    {
        try   { await action(); }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Erro ao fechar conexão '{Label}' durante teardown.", label);
        }
    }
}
