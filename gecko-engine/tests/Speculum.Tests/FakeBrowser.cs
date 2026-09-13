using System.Net.Sockets;
using Speculum.Supervisor.Control;
using Speculum.Supervisor.Wire;

namespace Speculum.Tests;

/// <summary>
/// O browser falso (L3).
///
/// O supervisor sobe ESTE binário como se fosse o Gecko: mesmos argumentos de
/// linha de comando (--headless -profile … about:blank), mesma variável
/// SPECULUM_BROWSER_SOCKET, mesmo ABI de envelope e de controle. O supervisor
/// não sabe — e não pode saber — que do outro lado do socket não há Gecko. É
/// isso que torna o L3 honesto: ele exercita o supervisor DE PRODUÇÃO, sem uma
/// linha alterada, sem bandeira de modo. A única coisa falsa é o motor.
///
/// Ele fala o roteiro do doc 19 §5: conecta, Hello, Ready; responde ContextCreate
/// com ContextCreated; responde Navigate com Navigated; e emite um fluxo contínuo
/// de frames pelo contexto criado. Cada passo é registrado no diário para que o
/// teste compare o que o browser fez com o que o supervisor entregou.
///
/// O papel é escolhido por SPECULUM_TESTS_ROLE=fake-browser no ambiente — uma
/// variável do ARNÊS de teste, nunca do produto. O supervisor e o lab não a leem;
/// só o próprio binário de teste, para decidir se roda como browser ou como
/// verificador. Nada no caminho de produção muda de comportamento.
/// </summary>
public static class FakeBrowser
{
    private const uint FakeBrowsingContextBase = 100000;

    public static async Task<int> RunAsync()
    {
        var socketPath = Environment.GetEnvironmentVariable("SPECULUM_BROWSER_SOCKET");
        if (string.IsNullOrWhiteSpace(socketPath))
        {
            Console.Error.WriteLine("[fake-browser] SPECULUM_BROWSER_SOCKET não definida");
            return 2;
        }

        var journal = new Journal(Environment.GetEnvironmentVariable("SPECULUM_FAKE_JOURNAL"));

        using var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        if (!await TryConnectAsync(socket, socketPath).ConfigureAwait(false))
        {
            journal.Write("connect-failed", $"socket={socketPath}");
            Console.Error.WriteLine($"[fake-browser] não conectou em {socketPath}");
            return 2;
        }

        journal.Write("connected", $"socket={socketPath}");
        journal.Write("pid", Environment.ProcessId.ToString());

        await using var stream = new NetworkStream(socket, ownsSocket: false);
        var reader = new EnvelopeReader(stream);
        await using var writer = new EnvelopeWriter(stream);

        using var life = new CancellationTokenSource();
        var emitter = new FrameEmitter(writer, journal);

        // Apresentação e prontidão. É o Ready que faz o supervisor pedir o contexto.
        await writer.WriteAsync(EnvelopeKind.Hello, 0, Array.Empty<byte>(), life.Token).ConfigureAwait(false);
        await writer.WriteAsync(EnvelopeKind.BrowserEvent, 0, EventReady(), life.Token).ConfigureAwait(false);
        journal.Write("ready", "");

        try
        {
            while (!life.IsCancellationRequested)
            {
                var message = await reader.ReadAsync(life.Token).ConfigureAwait(false);
                if (message is null)
                {
                    journal.Write("supervisor-closed", "");
                    break;
                }

                if (message.Value.Kind != EnvelopeKind.Control)
                {
                    continue;
                }

                await HandleControlAsync(message.Value.Payload, writer, emitter, journal, life).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // encerramento normal
        }
        catch (IOException)
        {
            // supervisor caiu — o par morre junto, sem drama
            journal.Write("bridge-broken", "");
        }
        finally
        {
            await emitter.StopAsync().ConfigureAwait(false);
        }

        return 0;
    }

    private static async Task HandleControlAsync(
        byte[] payload, EnvelopeWriter writer, FrameEmitter emitter, Journal journal, CancellationTokenSource life)
    {
        ControlOpCode opCode;
        try
        {
            opCode = new ControlReader(payload).OpCode;
        }
        catch (InvalidDataException ex)
        {
            journal.Write("control-illegible", ex.Message);
            return;
        }

        switch (opCode)
        {
            case ControlOpCode.ContextCreate:
            {
                // O ControlReader é ref struct: consome tudo num bloco que fecha
                // ANTES de qualquer await, senão ele viveria através do await.
                uint contextId;
                int width;
                int height;
                {
                    var reader = new ControlReader(payload);
                    contextId = reader.ReadUInt32();
                    width = reader.ReadInt32();
                    height = reader.ReadInt32();
                }

                journal.Write("context-create", $"ctx={contextId} w={width} h={height}");

                var browsingContextId = FakeBrowsingContextBase + contextId;
                await writer
                    .WriteAsync(EnvelopeKind.BrowserEvent, contextId, EventContextCreated(contextId, browsingContextId), life.Token)
                    .ConfigureAwait(false);
                journal.Write("context-created", $"ctx={contextId} bc={browsingContextId}");

                // Contexto existe: o fluxo de frames começa. É o análogo do bootstrap
                // que só emite quando há um documento montado.
                emitter.Start(contextId, life.Token);
                break;
            }

            case ControlOpCode.Navigate:
            {
                uint contextId;
                string url;
                {
                    var reader = new ControlReader(payload);
                    contextId = reader.ReadUInt32();
                    url = reader.ReadString();
                }

                journal.Write("navigate", $"ctx={contextId} url={url}");

                await writer
                    .WriteAsync(EnvelopeKind.BrowserEvent, contextId, EventNavigated(contextId, url), life.Token)
                    .ConfigureAwait(false);
                journal.Write("navigated", $"ctx={contextId} url={url}");
                break;
            }

            case ControlOpCode.Shutdown:
                journal.Write("shutdown", "");
                await life.CancelAsync().ConfigureAwait(false);
                break;

            default:
                journal.Write("control-ignored", opCode.ToString());
                break;
        }
    }

    // ---- eventos que o browser emite, montados pelo MESMO codec de produção ----

    private static byte[] EventReady()
    {
        var buffer = new byte[ControlWriter.HeaderBytes];
        _ = new ControlWriter(buffer, ControlOpCode.Ready, 0);
        return buffer;
    }

    private static byte[] EventContextCreated(uint contextId, uint browsingContextId)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint) + sizeof(ulong) + sizeof(uint)];
        var writer = new ControlWriter(buffer, ControlOpCode.ContextCreated, 0);
        writer.WriteUInt32(contextId);
        writer.WriteUInt64(browsingContextId);
        writer.WriteUInt32(0); // parent = 0: contexto raiz
        return buffer;
    }

    private static byte[] EventNavigated(uint contextId, string url)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint) + ControlWriter.SizeOfString(url)];
        var writer = new ControlWriter(buffer, ControlOpCode.Navigated, 0);
        writer.WriteUInt32(contextId);
        writer.WriteString(url);
        return buffer;
    }

    private static async Task<bool> TryConnectAsync(Socket socket, string path)
    {
        var endpoint = new UnixDomainSocketEndPoint(path);
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                await socket.ConnectAsync(endpoint).ConfigureAwait(false);
                return true;
            }
            catch (SocketException)
            {
                await Task.Delay(50).ConfigureAwait(false);
            }
        }

        return false;
    }

    /// <summary>
    /// Emite frames pelo contexto criado, num fluxo contínuo. Contínuo de
    /// propósito: um consumidor que conecta tarde ainda pega os próximos frames,
    /// então o teste nunca depende de uma corrida de largada. Cada frame carrega
    /// o contextId e uma sequência crescente.
    /// </summary>
    private sealed class FrameEmitter(EnvelopeWriter writer, Journal journal)
    {
        private Task _loop = Task.CompletedTask;
        private CancellationTokenSource? _own;

        public void Start(uint contextId, CancellationToken outer)
        {
            _own = CancellationTokenSource.CreateLinkedTokenSource(outer);
            _loop = LoopAsync(contextId, _own.Token);
        }

        private async Task LoopAsync(uint contextId, CancellationToken token)
        {
            ulong sequence = 1;
            try
            {
                while (!token.IsCancellationRequested)
                {
                    var frame = FakeFrame.Build(contextId, sequence);
                    await writer.WriteAsync(EnvelopeKind.Frame, contextId, frame, token).ConfigureAwait(false);
                    if (sequence == 1)
                    {
                        journal.Write("frames-started", $"ctx={contextId}");
                    }

                    sequence++;
                    await Task.Delay(25, token).ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException)
            {
                // parada normal
            }
            catch (IOException)
            {
                // ponte caiu
            }
            finally
            {
                journal.Write("frames-stopped", $"ctx={contextId} emitidos={sequence - 1}");
            }
        }

        public async Task StopAsync()
        {
            if (_own is not null)
            {
                await _own.CancelAsync().ConfigureAwait(false);
            }

            try
            {
                await _loop.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // esperado
            }

            _own?.Dispose();
        }
    }

    /// <summary>
    /// Diário do browser falso: o testemunho de uma ponta, para o teste cruzar
    /// com o que a outra ponta entregou. Uma linha por evento, "chave|detalhe".
    /// </summary>
    private sealed class Journal(string? path)
    {
        private readonly object _gate = new();

        public void Write(string key, string detail)
        {
            if (string.IsNullOrEmpty(path))
            {
                return;
            }

            try
            {
                lock (_gate)
                {
                    File.AppendAllText(path, $"{key}|{detail}\n");
                }
            }
            catch (IOException)
            {
                // diário é diagnóstico, nunca carga vital
            }
        }
    }
}
