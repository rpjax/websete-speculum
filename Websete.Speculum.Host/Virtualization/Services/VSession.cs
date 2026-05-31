using System.Threading.Channels;

namespace Websete.Speculum.Host.Virtualization.Services;

/*
 * Refactor
 */

public interface IVirtualizationSession2
{

}

// DTOs
public class Frame
{
    public ReadOnlyMemory<byte> Data { get; init; }
    public long Timestamp { get; init; }
}

public class InputEvent
{
    public string Type { get; init; }
    public string Payload { get; init; }
}

public class ControlEvent
{
    public string Type { get; init; }
    public string Payload { get; init; }
}

public interface IDownstreamConnection
{
    Task CloseAsync(CancellationToken ct = default));
}

public interface IVirtualBrowserConnection
{
    Task StopAsync(CancellationToken ct = default);
}

public interface IControlSource
{
    ChannelReader<ControlEvent> GetControlEventReader();
}

public interface IControlSink
{
    Task WriteControlEventAsync(
        ControlEvent controlEvent,
        CancellationToken ct = default);
}

public interface IFrameSource
{
    ChannelReader<Frame> GetFrameReader();
}

public interface IFrameSink
{
    Task WriteFrameAsync(
        Frame frame,
        CancellationToken ct = default);
}

public interface IInputSource
{
    ChannelReader<InputEvent> GetInputEventReader();
}

public interface IInputSink
{
    Task WriteInputEventAsync(
        InputEvent inputEvent,
        CancellationToken ct = default);
}

// produces console inputs
public interface IJsConsoleInputSource
{

}

// consumes console outputs
public interface IJsConsoleInputSink
{
    
}

// produces console outputs
public interface IJsConsoleOutputSource
{
    
}

// consumes console inputs
public interface IJsConsoleOutputSink
{

}

public class VSession : IVirtualizationSession2
{
    // Constants for internal state management
    const int StateStopped = 0;
    const int StateRunning = 1;

    // Dependencies
    private IDownstreamConnection _downstreamConnection { get; }
    private IVirtualBrowserConnection _virtualBrowserConnection { get; }
    // Frame source/sink abstractions for video streaming
    private IFrameSource _frameSource { get; }
    private IFrameSink _frameSink { get; }
    // Input source/sink abstractions for user input events
    private IInputSource _inputSource { get; }
    private IInputSink _inputSink { get; }
    // Logger for diagnostics and error reporting
    private ILogger _logger { get; }

    // Internal state
    private CancellationTokenSource _cancellationSource { get; }
    private int _sessionState;

    // Background tasks
    private Task? _controlProcessingTask { get; set; }
    private Task? _frameStreamingTask { get; set; }
    private Task? _inputProcessingTask { get; set; }

    public VSession(
        IDownstreamConnection downstreamConnection,
        IVirtualBrowserConnection virtualBrowserConnection,
        IFrameSource frameSource,
        IFrameSink frameSink,
        IInputSource inputSource,
        IInputSink inputSink,
        ILogger logger)
    {
        _downstreamConnection = downstreamConnection;
        _virtualBrowserConnection = virtualBrowserConnection;
        _frameSource = frameSource;
        _frameSink = frameSink;
        _inputSource = inputSource;
        _inputSink = inputSink;
        _logger = logger;

        _cancellationSource = new();
        _sessionState = StateStopped;

        _frameStreamingTask = null;
        _inputProcessingTask = null;
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _cancellationSource.Dispose();
        _frameStreamingTask = null;
        _inputProcessingTask = null;
        GC.SuppressFinalize(this);
    }

    public Task StartAsync(CancellationToken ct = default)
    {
        if (Interlocked.Exchange(ref _sessionState, StateRunning) == StateRunning)
        {
            throw new InvalidOperationException("A sessão já está em execução.");
        }

        // Vincula o token externo de inicialização ao token global da sessão
        var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, _cancellationSource.Token);

        // Despacha o processamento pesado do loop para o ThreadPool de forma não-bloqueante
        _frameStreamingTask = Task.Run(()
            => StartStreamingFramesAsync(_cancellationSource.Token), linkedCts.Token);

        _inputProcessingTask = Task.Run(() 
            => StartProcessingInputsAsync(_cancellationSource.Token), linkedCts.Token);

        return Task.CompletedTask;
    }

    public async Task StopAsync()
    {
        if (Interlocked.Exchange(ref _sessionState, StateStopped) == StateStopped)
        {
            return; // Previne reentrância caso StopAsync seja disparado em paralelo
        }

        _logger.LogInformation("Finalizando sessão de virtualização...");

        try
        {
            await _cancellationSource.CancelAsync();
        }
        catch (Exception ex)
        {
            _logger.LogCritical(ex, "Erro ao disparar sinal de cancelamento da sessão.");
        }

        // Agrupa as duas tarefas ativas para aguardar a limpeza completa dos buffers
        var backgroundTasks = new List<Task>();

        if (_frameStreamingTask != null) 
            backgroundTasks.Add(_frameStreamingTask);
        if (_inputProcessingTask != null) 
            backgroundTasks.Add(_inputProcessingTask);

        if (backgroundTasks.Count > 0)
        {
            try
            {
                // Aguarda de forma concorrente a conclusão orgânica ou forçada de ambos os loops
                await Task.WhenAll(backgroundTasks);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Ocorreu uma falha ao encerrar as tarefas de plano de fundo da sessão.");
            }
        }
    }

    private async Task StartStreamingFramesAsync(CancellationToken ct)
    {
        try
        {
            var reader = _frameSource.GetFrameReader();

            await foreach (var frame in reader.ReadAllAsync(ct))
            {
                if (ct.IsCancellationRequested) break;

                try
                {
                    await _frameSink.WriteFrameAsync(frame, ct);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Falha ao encaminhar frame no pipeline de mídia (Downstream).");
                    break; // Quebra o loop caso o canal de saída sofra um colapso (ex: desconexão do cliente)
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Cancelamento limpo via token da sessão
        }
        catch (Exception ex)
        {
            _logger.LogCritical(ex, "Falha crítica não tratada no pipeline de frames.");
        }
        finally
        {
            _logger.LogInformation("Loop de streaming de frames encerrado.");
        }
    }

    private async Task StartProcessingInputsAsync(CancellationToken ct)
    {
        try
        {
            var reader = _inputSource.GetInputEventReader();

            // Consome continuamente os eventos enviados pelo cliente através do canal de entrada
            await foreach (var inputEvent in reader.ReadAllAsync(ct))
            {
                if (ct.IsCancellationRequested) break;

                try
                {
                    // Despacha o input para o Sink (Node.js/Sidecar -> xdotool)
                    await _inputSink.WriteInputEventAsync(inputEvent, ct);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Falha ao injetar evento de input no pipeline do navegador virtual (Upstream).");
                    // Diferente do vídeo, uma falha isolada de input (ex: lag de digitação) 
                    // pode tolerar um 'continue' para não derrubar a usabilidade da sessão inteira de imediato
                    continue;
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Cancelamento limpo via token da sessão
        }
        catch (Exception ex)
        {
            _logger.LogCritical(ex, "Falha crítica não tratada no pipeline de inputs.");
        }
        finally
        {
            _logger.LogInformation("Loop de processamento de inputs encerrado.");
        }
    }

}
