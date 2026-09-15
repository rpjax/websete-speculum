using System.Net.Sockets;
using System.Text;
using System.Threading;
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
    private static int _ppFrames;
    private static uint _sessionContextId;

    public static async Task<int> RunAsync()
    {
        var socketPath = Environment.GetEnvironmentVariable("SPECULUM_BROWSER_SOCKET");
        if (string.IsNullOrWhiteSpace(socketPath))
        {
            Console.Error.WriteLine("[fake-browser] SPECULUM_BROWSER_SOCKET não definida");
            return 2;
        }

        var journal = new Journal(Environment.GetEnvironmentVariable("SPECULUM_FAKE_JOURNAL"));
        var mode = Environment.GetEnvironmentVariable("SPECULUM_FAKE_MODE") ?? "wiring";
        journal.Write("mode", mode);
        ProducerCli? producer = null;
        if (mode == "pp")
        {
            if (!ProducerCli.TryStart(out producer, out var problem) || producer is null)
            {
                journal.Write("producer-cli-failed", problem);
                Console.Error.WriteLine($"[fake-browser] CLI: {problem}");
                return 2;
            }
        }

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

                if (message.Value.Kind == EnvelopeKind.Asset)
                {
                    HandleIncomingAsset(message.Value.Payload, journal);
                    continue;
                }

                if (message.Value.Kind != EnvelopeKind.Control)
                {
                    continue;
                }

                try
                {
                    await HandleControlAsync(message.Value.Payload, writer, emitter, journal, life, mode, producer).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    journal.Write("control-error", ex.Message);
                }
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
            producer?.Dispose();
        }

        return 0;
    }

    private static async Task HandleControlAsync(
        byte[] payload, EnvelopeWriter writer, FrameEmitter emitter, Journal journal, CancellationTokenSource life,
        string mode, ProducerCli? producer)
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
                _sessionContextId = contextId;

                if (mode == "wiring")
                {
                    emitter.Start(contextId, life.Token);
                }
                else if (mode == "pp" && producer is not null)
                {
                    var boot = producer.Boot();
                    if (boot is not null)
                    {
                        await writer.WriteAsync(EnvelopeKind.Frame, contextId, boot, life.Token).ConfigureAwait(false);
                        WritePpFrame(boot);
                    }
                }
                else if (mode == "assets")
                {
                    await EmitAssetsAsync(writer, contextId, journal, life.Token).ConfigureAwait(false);
                }

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

                if (mode == "marionette")
                {
                    var dialog = ControlCommand.DialogRequested(0, contextId, 7, "confirm?"u8.ToArray());
                    await writer.WriteAsync(EnvelopeKind.BrowserEvent, contextId, dialog, life.Token).ConfigureAwait(false);
                    journal.Write("dialog-requested", $"ctx={contextId} req=7");
                }

                break;
            }

            case ControlOpCode.Shutdown:
                journal.Write("shutdown", "");
                await life.CancelAsync().ConfigureAwait(false);
                break;

            case ControlOpCode.Resync:
            {
                uint contextId;
                byte force;
                {
                    var reader = new ControlReader(payload);
                    contextId = reader.ReadUInt32();
                    force = reader.ReadUInt8();
                }

                journal.Write("resync", $"ctx={contextId} force={force}");
                if (mode == "pp" && producer is not null)
                {
                    var frame = producer.Resync();
                    if (frame is not null)
                    {
                        var target = contextId == 0 ? _sessionContextId : contextId;
                        await writer.WriteAsync(EnvelopeKind.Frame, target, frame, life.Token).ConfigureAwait(false);
                        WritePpFrame(frame);
                    }
                }
                else if (mode == "marionette")
                {
                    var target = contextId == 0 ? _sessionContextId : contextId;
                    var dialog = ControlCommand.DialogRequested(0, target, 7, "confirm?"u8.ToArray());
                    await writer.WriteAsync(EnvelopeKind.BrowserEvent, target, dialog, life.Token).ConfigureAwait(false);
                    journal.Write("dialog-requested", $"ctx={target} req=7");
                }
                else if (mode == "assets")
                {
                    var target = contextId == 0 ? _sessionContextId : contextId;
                    await EmitAssetsAsync(writer, target, journal, life.Token).ConfigureAwait(false);
                }
                else if (mode == "wiring")
                {
                    await emitter.EmitResyncAsync(contextId, life.Token).ConfigureAwait(false);
                }

                break;
            }

            case ControlOpCode.HaltClocks:
                journal.Write("halt", "");
                producer?.Halt();
                break;

            case ControlOpCode.ResumeClocks:
                journal.Write("resume", "");
                producer?.Resume();
                break;

            case ControlOpCode.FlushFrame:
            {
                journal.Write("flush", "");
                var frame = producer?.Flush();
                if (frame is not null)
                {
                    var ctx = new ControlReader(payload).ReadUInt32();
                    var target = ctx == 0 ? _sessionContextId : ctx;
                    await writer.WriteAsync(EnvelopeKind.Frame, target, frame, life.Token).ConfigureAwait(false);
                    WritePpFrame(frame);
                }

                break;
            }

            case ControlOpCode.Snapshot:
            {
                uint contextId;
                uint corr;
                {
                    var reader = new ControlReader(payload);
                    corr = reader.CorrelationId;
                    contextId = reader.ReadUInt32();
                }

                journal.Write("snapshot", $"ctx={contextId}");
                var dump = producer?.Snapshot() ?? new byte[28];
                ulong hash = 0;
                if (dump.Length >= 20)
                {
                    hash = System.Buffers.Binary.BinaryPrimitives.ReadUInt64LittleEndian(dump.AsSpan(12));
                }

                uint seq = dump.Length >= 4 ? System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(dump) : 1;
                var served = ControlCommand.SnapshotServed(corr, seq, 0, contextId == 0 ? 1 : contextId, hash, dump);
                await writer.WriteAsync(EnvelopeKind.BrowserEvent, contextId, served, life.Token).ConfigureAwait(false);
                break;
            }

            case ControlOpCode.Input:
            {
                uint contextId;
                byte type;
                {
                    var reader = new ControlReader(payload);
                    contextId = reader.ReadUInt32();
                    type = reader.ReadUInt8();
                    if (type is < 1 or > 5)
                    {
                        journal.Write("input", $"ctx={contextId} reject type={type}");
                        break;
                    }

                    if (type is ControlCommand.InputDown or ControlCommand.InputUp)
                    {
                        var nodeId = reader.ReadUInt32();
                        if (nodeId == 0)
                        {
                            journal.Write("input", $"ctx={contextId} reject node=0");
                            break;
                        }

                        journal.Write("input", $"ctx={contextId} admit type={type} node={nodeId}");
                        break;
                    }

                    journal.Write("input", $"ctx={contextId} admit type={type}");
                }

                break;
            }

            case ControlOpCode.ViewportSet:
            {
                uint contextId;
                int width;
                int height;
                {
                    var reader = new ControlReader(payload);
                    contextId = reader.ReadUInt32();
                    width = reader.ReadInt32();
                    height = reader.ReadInt32();
                }

                journal.Write("viewport", $"ctx={contextId} {width}x{height}");
                break;
            }

            case ControlOpCode.HistoryGo:
            {
                uint contextId;
                int delta;
                {
                    var reader = new ControlReader(payload);
                    contextId = reader.ReadUInt32();
                    delta = reader.ReadInt32();
                }

                journal.Write("history", $"go ctx={contextId} delta={delta}");
                break;
            }

            case ControlOpCode.Reload:
                journal.Write("reload", "");
                break;

            case ControlOpCode.Stop:
                journal.Write("stop", "");
                break;

            case ControlOpCode.DialogRespond:
                journal.Write("dialog-respond", "");
                break;

            case ControlOpCode.PermissionRespond:
                journal.Write("permission-respond", "");
                break;

            case ControlOpCode.DownloadRespond:
                journal.Write("download-respond", "");
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

    private static void HandleIncomingAsset(byte[] payload, Journal journal)
    {
        try
        {
            var decoded = AssetPayload.Decode(payload);
            var text = Encoding.UTF8.GetString(decoded.Data);
            var deny = decoded.Phase == AssetPayload.PhaseRequest;
            if (deny)
            {
                if (AssetClassifier.TryDecodeRequestData(decoded.Data, out var dest, out _, out _))
                {
                    deny = !AssetClassifier.CanExit(dest);
                }
                else
                {
                    deny = text.Contains(".html", StringComparison.OrdinalIgnoreCase)
                        || text.Contains(".js", StringComparison.OrdinalIgnoreCase)
                        || text.Contains(".css", StringComparison.OrdinalIgnoreCase)
                        || text.Contains("text/html", StringComparison.OrdinalIgnoreCase)
                        || text.Contains("javascript", StringComparison.OrdinalIgnoreCase)
                        || text.Contains("text/css", StringComparison.OrdinalIgnoreCase)
                        || text.Contains("xmlhttprequest", StringComparison.OrdinalIgnoreCase);
                }
            }

            journal.Write(deny ? "asset-denied" : "asset-in", $"stream={decoded.StreamId} phase={decoded.Phase}");
        }
        catch (InvalidDataException ex)
        {
            journal.Write("asset-illegible", ex.Message);
        }
    }

    private static async Task EmitAssetsAsync(EnvelopeWriter writer, uint contextId, Journal journal, CancellationToken token)
    {
        var png = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
        await writer.WriteAsync(EnvelopeKind.Asset, contextId, AssetPayload.Encode(1, AssetPayload.PhaseChunk, 0, png), token)
            .ConfigureAwait(false);
        await writer.WriteAsync(EnvelopeKind.Asset, contextId, AssetPayload.Encode(1, AssetPayload.PhaseComplete, (ulong)png.Length, []), token)
            .ConfigureAwait(false);
        await writer.WriteAsync(EnvelopeKind.Asset, contextId, AssetPayload.Encode(2, AssetPayload.PhaseDenied, 0, "text/html"u8.ToArray()), token)
            .ConfigureAwait(false);
        journal.Write("asset-chunk", "png");
        journal.Write("asset-denied", "html");
    }

    private static void WritePpFrame(byte[] frame)
    {
        var dir = Environment.GetEnvironmentVariable("SPECULUM_PP_FRAMES_DIR");
        if (string.IsNullOrWhiteSpace(dir))
        {
            return;
        }

        Directory.CreateDirectory(dir);
        var i = Interlocked.Increment(ref _ppFrames) - 1;
        File.WriteAllBytes(Path.Combine(dir, $"frame_{i}.bin"), frame);
        File.AppendAllText(Path.Combine(dir, "frames.txt"), $"frame_{i}.bin\n");
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
        private uint _contextId;
        private long _sequence;

        public uint ContextId => _contextId;

        public void Start(uint contextId, CancellationToken outer)
        {
            _own = CancellationTokenSource.CreateLinkedTokenSource(outer);
            _contextId = contextId;
            _loop = LoopAsync(contextId, _own.Token);
        }

        public async Task EmitResyncAsync(uint contextId, CancellationToken token)
        {
            var target = contextId == 0 ? _contextId : contextId;
            var seq = (ulong)Interlocked.Increment(ref _sequence);
            var frame = FakeFrame.Build(target, seq, FakeFrame.ResyncFlag);
            await writer.WriteAsync(EnvelopeKind.Frame, target, frame, token).ConfigureAwait(false);
            journal.Write("resync-frame", $"ctx={target} seq={seq}");
        }

        private async Task LoopAsync(uint contextId, CancellationToken token)
        {
            try
            {
                while (!token.IsCancellationRequested)
                {
                    var seq = (ulong)Interlocked.Increment(ref _sequence);
                    var frame = FakeFrame.Build(contextId, seq);
                    await writer.WriteAsync(EnvelopeKind.Frame, contextId, frame, token).ConfigureAwait(false);
                    if (seq == 1)
                    {
                        journal.Write("frames-started", $"ctx={contextId}");
                    }

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
                journal.Write("frames-stopped", $"ctx={contextId} emitidos={Volatile.Read(ref _sequence)}");
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
                    using var fs = new FileStream(
                        path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
                    using var writer = new StreamWriter(fs) { AutoFlush = true };
                    writer.Write($"{key}|{detail}\n");
                }
            }
            catch (IOException)
            {
                // diário é diagnóstico, nunca carga vital
            }
        }
    }
}
