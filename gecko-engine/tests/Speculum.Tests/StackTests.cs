using System.Buffers.Binary;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using Speculum.Supervisor.Control;
using Speculum.Supervisor.Wire;

namespace Speculum.Tests;

/// <summary>
/// L4 — a pilha real (doc 19 §6).
///
/// A stack de produção inteira: supervisor real + Gecko REAL já construído. O
/// harness é um consumidor como qualquer outro — conecta no plano de consumo,
/// recebe frames de verdade e lê o prefixo selado de cada um. Precisa do binário
/// do Gecko; por isso só roda com <c>run.sh --stack</c>.
///
/// O que prova, ponta a ponta:
///   1. supervisor sobe → browser conecta → Ready (implícito: sem isso não há frame)
///   2. ContextCreate → ContextCreated (o supervisor pede sozinho no Ready)
///   3. Navigate → Navigated (o supervisor navega sozinho no ContextCreated)
///   4. pelo menos um frame chega, de UM contexto, com prefixo selado válido e
///      contextId carimbado pelo pai igual ao contexto raiz
///   5. o comando de navegação do consumidor chega ao browser real e a página
///      pedida é projetada — frame novo, diferente do bootstrap anterior
///
/// A procedência do frame é medida direto do fio: o contextId vem do offset 4 do
/// prefixo, carimbado pelo processo pai. Se o pai registrar a janela chrome em
/// vez do contexto do conteúdo, ou nenhum frame chega, ou chega com contextId
/// errado — e a saída deste degrau diz qual dos dois, sem investigação.
/// </summary>
public static class StackTests
{
    public static async Task<int> RunAsync()
    {
        var report = new Report("L4 pilha real");
        Console.WriteLine("L4 — pilha real (supervisor + Gecko de verdade)");

        var pages = PageFixtures.Start();
        try
        {
            await RunRootNavAsync(report, pages);
            if (!report.Failed)
            {
                // O Gecko anterior precisa soltar compositor/perfil antes do próximo.
                await Task.Delay(2000);
                await RunMultiplexAsync(report, pages);
            }

            return report.Finish();
        }
        finally
        {
            pages.Dispose();
        }
    }

    private static async Task RunRootNavAsync(Report report, PageFixtures pages)
    {
        var browserBin = Environment.GetEnvironmentVariable("SPECULUM_STACK_BROWSER_BIN");
        var url = Environment.GetEnvironmentVariable("SPECULUM_STACK_URL") ?? pages.FirstUrl;
        var secondUrl = Environment.GetEnvironmentVariable("SPECULUM_STACK_URL2") ?? pages.SecondUrl;

        if (!Harness.TryDotnet(out var dotnet, out var pDot))
        {
            report.Fail("dotnet", "SPECULUM_DOTNET válido", pDot, "rode pelo run.sh");
            return;
        }

        if (!Harness.TryDll("SPECULUM_SUPERVISOR_DLL", out var supervisorDll, out var pSup))
        {
            report.Fail("dll do supervisor", "SPECULUM_SUPERVISOR_DLL construída", pSup, "rode pelo run.sh");
            return;
        }

        if (string.IsNullOrWhiteSpace(browserBin) || !File.Exists(browserBin))
        {
            report.Fail("binário do Gecko", "SPECULUM_STACK_BROWSER_BIN apontando para o firefox construído",
                browserBin ?? "não definida", "L4 exige a stack real; rode run.sh --stack com o objdir construído");
            return;
        }

        var port = FreeTcpPort();
        var socketPath = $"/tmp/spec-l4-{Guid.NewGuid():n}"[..24] + ".sock";
        File.Delete(socketPath);

        var log = new StringBuilder();
        var supervisor = StartSupervisor(dotnet, supervisorDll, browserBin, url, port, socketPath, log);

        try
        {
            using var client = await ConnectConsumerAsync(port, supervisor, TimeSpan.FromSeconds(60));

            // (2)(3)(4): o supervisor pede contexto e navega sozinho. O primeiro
            // envelope pode ser o about:blank do contexto; o aceite é o frame da
            // URL fria com o texto da página — sem Navigate do consumidor.
            var first = await ReceiveUntilAsync(client, TimeSpan.FromSeconds(60), seen =>
                seen.Any(f => FrameHasText(f, "alpha")));
            report.Equal("frames reais recebidos (bootstrap)", true, first.Count >= 1);

            var boot = first.FirstOrDefault(f => FrameHasText(f, "alpha"));
            uint rootContext = 0;
            var contexts = new HashSet<uint>();
            if (boot is not null)
            {
                var h = SealedFrame.Parse(boot);
                if (!h.Ok)
                {
                    report.Fail("frame bootstrap: prefixo selado", "magic 0x5050 version 2", h.Problem ?? "?",
                        Report.Hex(boot.AsSpan(0, Math.Min(SealedFrame.PrefixBytes, boot.Length))));
                }
                else
                {
                    report.Pass($"frame bootstrap: prefixo selado (ctx={h.ContextId} gen={h.Generation} seq={h.Sequence})");
                    contexts.Add(h.ContextId);
                    rootContext = h.ContextId;
                    report.Equal("frame bootstrap é resync", true, (h.Flags & SealedFrame.ResyncFlag) != 0);
                    report.Equal("frame bootstrap geração inicial 1", 1u, h.Generation);
                    report.Equal("frame bootstrap fecha com CHECK", true, FrameStrings.HasClosingCheck(boot));
                }
            }

            // (4): um contexto só no bootstrap. Vários = o pai carimbou contextos
            // demais (a suspeita chrome-vs-conteúdo apareceria aqui).
            report.Equal("contextos distintos no bootstrap", 1, contexts.Count);
            report.Equal("contextId é o raiz da sessão", 1u, rootContext);

            if (boot is not null)
            {
                AssertPageText(report, boot, "alpha", "bootstrap (página /a)");
            }

            var mutated = await ReceiveUntilAsync(client, TimeSpan.FromSeconds(30), seen =>
                seen.Any(f =>
                {
                    var h = SealedFrame.Parse(f);
                    return h.Ok && (h.Flags & SealedFrame.ResyncFlag) == 0 && h.PreTableHash != 0;
                }));
            SealedFrame.Header ordinary = default;
            foreach (var frame in mutated)
            {
                var h = SealedFrame.Parse(frame);
                if (h.Ok && (h.Flags & SealedFrame.ResyncFlag) == 0)
                {
                    ordinary = h;
                    break;
                }
            }
            report.Equal("frame ordinário depois da mutação", true, ordinary.Ok);
            if (ordinary.Ok)
            {
                report.Equal("preTableHash ordinário ≠ 0", true, ordinary.PreTableHash != 0);
                report.Equal("mutação: geração intacta", 1u, ordinary.Generation);
            }

            await SendConsumerResyncAsync(client);
            var recovered = await ReceiveFramesAsync(client, count: 1, TimeSpan.FromSeconds(60));
            report.Equal("frames após resync do consumidor", true, recovered.Count >= 1);
            if (recovered.Count >= 1)
            {
                var rh = SealedFrame.Parse(recovered[^1]);
                report.Equal("resync: prefixo selado", true, rh.Ok);
                report.Equal("resync: flag no fio", true, rh.Ok && (rh.Flags & SealedFrame.ResyncFlag) != 0);
                report.Equal("resync: geração intacta", 1u, rh.Generation);
                report.Equal("resync: fecha com CHECK", true, recovered.Count >= 1 && FrameStrings.HasClosingCheck(recovered[^1]));
            }

            // (5): o comando do consumidor chega ao browser real E a página nova é
            // projetada. Contar frame não basta: o bootstrap do documento anterior
            // pode chegar depois do comando e fingir sucesso. O documento é outro,
            // então o frame é outro — comparamos os bytes E o texto da tabela
            // (o mesmo layout de decode.ts).
            await SendConsumerNavigateAsync(client, secondUrl);
            var after = await ReceiveFramesAsync(client, count: 1, TimeSpan.FromSeconds(60));
            report.Equal("frames após navegação do consumidor", true, after.Count >= 1);

            var projectedSecondPage = after.Count >= 1 && first.Count >= 1
                && !after[^1].AsSpan().SequenceEqual(first[0]);
            report.Equal($"a página nova ({secondUrl}) foi projetada", true, projectedSecondPage);

            if (after.Count >= 1)
            {
                AssertPageText(report, after[^1], "bravo", "depois do Navigate (página /b)");
            }

            await client.SendAsync(
                ControlCommand.HistoryGo(0, 0, -1),
                WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);
            var back = await ReceiveUntilAsync(client, TimeSpan.FromSeconds(60), seen =>
                seen.Any(f =>
                {
                    var h = SealedFrame.Parse(f);
                    return h.Ok && FrameStrings.TryReadLocal(f, out var s, out _) &&
                           FrameStrings.Contains(s, "alpha");
                }));
            report.Equal("back muda o texto para alpha", true,
                back.Any(f =>
                {
                    var h = SealedFrame.Parse(f);
                    return h.Ok && FrameStrings.TryReadLocal(f, out var s, out _) &&
                           FrameStrings.Contains(s, "alpha");
                }));

            await client.SendAsync(
                ControlCommand.ViewportSet(0, 0, 800, 600),
                WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);
            await client.SendAsync(
                ControlCommand.Snapshot(0, 0),
                WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);

            await client.SendAsync(
                ControlCommand.InputKey(0, 0, ControlCommand.InputKeyDown, "x", "KeyX", 0),
                WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);
            await client.SendAsync(
                ControlCommand.InputKey(0, 0, ControlCommand.InputKeyUp, "x", "KeyX", 0),
                WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);
            var clicked = await ReceiveUntilAsync(client, TimeSpan.FromSeconds(30), seen =>
                seen.Any(f =>
                    SealedFrame.Parse(f).Ok && FrameStrings.TryReadLocal(f, out var s, out _) &&
                    FrameStrings.Contains(s, "clicked")));
            report.Equal("gesto muda o texto para clicked", true,
                clicked.Any(f =>
                    SealedFrame.Parse(f).Ok && FrameStrings.TryReadLocal(f, out var s, out _) &&
                    FrameStrings.Contains(s, "clicked")));

            await client.SendAsync(
                ControlCommand.Navigate(0, 0, pages.AlertUrl),
                WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);
            var dialog = await ReceiveUntilAsync(client, TimeSpan.FromSeconds(30), seen =>
                seen.Any(IsDialogRequested));
            report.Equal("alerta pede DialogRequested", true, dialog.Any(IsDialogRequested));
            if (dialog.Any(IsDialogRequested))
            {
                var ev = dialog.Last(IsDialogRequested);
                var payload = ev.AsSpan(Envelope.HeaderBytes);
                var reader = new ControlReader(payload);
                var ctx = reader.ReadUInt32();
                var requestId = reader.ReadUInt32();
                await client.SendAsync(
                    ControlCommand.DialogRespond(1, ctx, requestId, "ok"u8.ToArray()),
                    WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);
                var answered = await ReceiveUntilAsync(client, TimeSpan.FromSeconds(30), seen =>
                    seen.Any(f =>
                        SealedFrame.Parse(f).Ok && FrameStrings.TryReadLocal(f, out var s, out _) &&
                        FrameStrings.Contains(s, "answered")));
                report.Equal("alerta espera resposta e segue", true,
                    answered.Any(f =>
                        SealedFrame.Parse(f).Ok && FrameStrings.TryReadLocal(f, out var s, out _) &&
                        FrameStrings.Contains(s, "answered")));
            }

            var assetBody = AssetPayload.EncodeRequest(1, pages.PixelUrl, "");
            var assetEnv = new byte[Envelope.HeaderBytes + assetBody.Length];
            Envelope.WriteHeader(assetEnv, EnvelopeKind.Asset, 1, assetBody.Length);
            Buffer.BlockCopy(assetBody, 0, assetEnv, Envelope.HeaderBytes, assetBody.Length);
            await client.SendAsync(assetEnv, WebSocketMessageType.Binary, true, CancellationToken.None);
            var photo = await ReceiveUntilAsync(client, TimeSpan.FromSeconds(30), seen =>
                seen.Any(f => Envelope.TryReadComplete(f, EnvelopeKind.Asset, out _, out _)));
            report.Equal("foto: envelope de ativo no consumidor", true,
                photo.Any(f => Envelope.TryReadComplete(f, EnvelopeKind.Asset, out _, out _)));

            var svgBody = AssetPayload.EncodeRequest(1, pages.SvgUrl, "");
            var svgEnv = new byte[Envelope.HeaderBytes + svgBody.Length];
            Envelope.WriteHeader(svgEnv, EnvelopeKind.Asset, 1, svgBody.Length);
            Buffer.BlockCopy(svgBody, 0, svgEnv, Envelope.HeaderBytes, svgBody.Length);
            await client.SendAsync(svgEnv, WebSocketMessageType.Binary, true, CancellationToken.None);
            var svgSeen = await ReceiveUntilAsync(client, TimeSpan.FromSeconds(30), seen =>
                seen.Any(f =>
                {
                    if (!Envelope.TryReadComplete(f, EnvelopeKind.Asset, out _, out _))
                    {
                        return false;
                    }
                    try
                    {
                        var decoded = AssetPayload.Decode(f.AsSpan(Envelope.HeaderBytes));
                        return decoded.Phase == AssetPayload.PhaseComplete &&
                               Encoding.UTF8.GetString(decoded.Data) == "image/svg+xml";
                    }
                    catch (InvalidDataException)
                    {
                        return false;
                    }
                }));
            report.Equal("SVG: complete com image/svg+xml", true,
                svgSeen.Any(f =>
                {
                    if (!Envelope.TryReadComplete(f, EnvelopeKind.Asset, out _, out _))
                    {
                        return false;
                    }
                    try
                    {
                        var decoded = AssetPayload.Decode(f.AsSpan(Envelope.HeaderBytes));
                        return decoded.Phase == AssetPayload.PhaseComplete &&
                               Encoding.UTF8.GetString(decoded.Data) == "image/svg+xml";
                    }
                    catch (InvalidDataException)
                    {
                        return false;
                    }
                }));
            var svgMarkup = Encoding.UTF8.GetBytes(
                "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"/>");
            report.Equal("SVG: chunk com os bytes", true,
                svgSeen.Any(f =>
                {
                    if (!Envelope.TryReadComplete(f, EnvelopeKind.Asset, out _, out _))
                    {
                        return false;
                    }
                    try
                    {
                        var decoded = AssetPayload.Decode(f.AsSpan(Envelope.HeaderBytes));
                        return decoded.Phase == AssetPayload.PhaseChunk &&
                               decoded.Data.AsSpan().SequenceEqual(svgMarkup);
                    }
                    catch (InvalidDataException)
                    {
                        return false;
                    }
                }));

            await CloseAsync(client);
        }
        catch (Exception ex)
        {
            report.Fail("execução da pilha", "roteiro do doc 19 §6", ex.Message);
        }
        finally
        {
            StopSupervisor(supervisor);
        }

        if (report.Failed)
        {
            Console.WriteLine();
            Console.WriteLine("---- log do supervisor (stack real) ----");
            Console.WriteLine(log.ToString().TrimEnd());
            Console.WriteLine("----------------------------------------");
        }

        File.Delete(socketPath);
    }

    private static async Task RunMultiplexAsync(Report report, PageFixtures pages)
    {
        if (!Harness.TryDotnet(out var dotnet, out _) ||
            !Harness.TryDll("SPECULUM_SUPERVISOR_DLL", out var supervisorDll, out _))
        {
            return;
        }

        var browserBin = Environment.GetEnvironmentVariable("SPECULUM_STACK_BROWSER_BIN");
        if (string.IsNullOrWhiteSpace(browserBin) || !File.Exists(browserBin))
        {
            return;
        }

        Console.WriteLine("L4 — multiplex (iframe → contextId)");
        var port = FreeTcpPort();
        var socketPath = $"/tmp/spec-l4m-{Guid.NewGuid():n}"[..24] + ".sock";
        File.Delete(socketPath);

        var log = new StringBuilder();
        var supervisor = StartSupervisor(dotnet, supervisorDll, browserBin, pages.HostUrl, port, socketPath, log);

        try
        {
            using var client = await ConnectConsumerAsync(port, supervisor, TimeSpan.FromSeconds(60));
            var frames = await ReceiveUntilAsync(client, TimeSpan.FromSeconds(60), seen =>
                HasChildScope(seen, 1, 2) && HasTextOnContext(seen, 2, "inner-alpha"));

            report.Equal("host NODE_NEW com childScopeId=2", true, HasChildScope(frames, 1, 2));
            report.Equal("frame C=2 com inner-alpha", true, HasTextOnContext(frames, 2, "inner-alpha"));
            int hostAt = FirstIndexWithChildScope(frames, 1, 2);
            int childAt = FirstIndexWithTextOnContext(frames, 2, "inner-alpha");
            report.Equal("C=2 so depois do host no pai", true,
                hostAt >= 0 && childAt >= 0 && childAt >= hostAt);

            uint? firstInnerGen = FirstGeneration(frames, 2, "inner-alpha");
            var afterInnerNav = await ReceiveUntilAsync(client, TimeSpan.FromSeconds(60), seen =>
            {
                var all = frames.Concat(seen).ToList();
                return HasTextOnContext(all, 2, "inner-bravo") &&
                       firstInnerGen is uint g &&
                       all.Any(f =>
                       {
                           var h = SealedFrame.Parse(f);
                           return h.Ok && h.ContextId == 2 && h.Generation > g &&
                                  FrameStrings.TryReadLocal(f, out var s, out _) &&
                                  FrameStrings.Contains(s, "inner-bravo");
                       });
            });
            frames.AddRange(afterInnerNav);

            report.Equal("nav do iframe: mesmo C=2", true, HasTextOnContext(frames, 2, "inner-bravo"));
            report.Equal("nav do iframe: generation subiu", true,
                firstInnerGen is uint g0 &&
                frames.Any(f =>
                {
                    var h = SealedFrame.Parse(f);
                    return h.Ok && h.ContextId == 2 && h.Generation > g0 &&
                           FrameStrings.TryReadLocal(f, out var s, out _) &&
                           FrameStrings.Contains(s, "inner-bravo");
                }));
            report.Equal("nav do iframe nao mintou C=3", false, frames.Any(f =>
            {
                var h = SealedFrame.Parse(f);
                return h.Ok && h.ContextId == 3;
            }));

            await SendConsumerNavigateAsync(client, pages.Host2Url);
            var afterSwap = await ReceiveUntilAsync(client, TimeSpan.FromSeconds(60), seen =>
                HasChildScope(seen, 1, 3) || HasTextOnContext(seen, 3, "inner-alpha"));
            frames.AddRange(afterSwap);

            report.Equal("novo host mintou C=3", true,
                HasChildScope(afterSwap, 1, 3) || HasTextOnContext(afterSwap, 3, "inner-alpha"));

            var created = CountLog(log.ToString(), "contexto 1 criado");
            var createdNested = CountLog(log.ToString(), "contexto 2 criado");
            report.Equal("um ContextCreated da aba", 1, created);
            report.Equal("nenhum ContextCreated de iframe", 0, createdNested);

            foreach (var frame in frames)
            {
                var h = SealedFrame.Parse(frame);
                if (!h.Ok || (h.Flags & SealedFrame.ResyncFlag) != 0)
                {
                    continue;
                }

                report.Equal($"ctx={h.ContextId} seq={h.Sequence} preTableHash ordinário", true,
                    h.PreTableHash != 0);
            }

            await CloseAsync(client);
        }
        catch (Exception ex)
        {
            report.Fail("multiplex", "iframe C + generation + remint", ex.Message);
        }
        finally
        {
            StopSupervisor(supervisor);
        }

        if (report.Failed)
        {
            Console.WriteLine();
            Console.WriteLine("---- log do supervisor (multiplex) ----");
            Console.WriteLine(log.ToString().TrimEnd());
            Console.WriteLine("----------------------------------------");
        }

        File.Delete(socketPath);
    }

    private static Process StartSupervisor(
        string dotnet, string supervisorDll, string browserBin, string url, int port, string socketPath, StringBuilder log)
    {
        var info = new ProcessStartInfo(dotnet)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Path.GetDirectoryName(supervisorDll) ?? ".",
        };
        info.ArgumentList.Add(supervisorDll);
        info.Environment["SPECULUM_BROWSER_BIN"] = browserBin;
        info.Environment["SPECULUM_BROWSER_URL"] = url;
        info.Environment["SPECULUM_SUPERVISOR_PORT"] = port.ToString();
        info.Environment["SPECULUM_BROWSER_SOCKET"] = socketPath;

        var process = new Process { StartInfo = info, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => Append(log, e.Data);
        process.ErrorDataReceived += (_, e) => Append(log, e.Data);
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        return process;
    }

    private static async Task<ClientWebSocket> ConnectConsumerAsync(int port, Process supervisor, TimeSpan timeout)
    {
        var uri = new Uri($"ws://127.0.0.1:{port}/session");
        var deadline = DateTime.UtcNow + timeout;
        while (true)
        {
            if (supervisor.HasExited)
            {
                throw new InvalidOperationException($"supervisor saiu antes de aceitar consumidor (código {SafeExit(supervisor)})");
            }

            // Um ClientWebSocket morto não reconecta: cada tentativa é uma
            // instância nova, e a que falha é descartada.
            var client = new ClientWebSocket();
            try
            {
                await client.ConnectAsync(uri, CancellationToken.None);
                return client;
            }
            catch (WebSocketException)
            {
                client.Dispose();
                if (DateTime.UtcNow > deadline)
                {
                    throw new TimeoutException($"consumidor não conectou em {uri} em {timeout.TotalSeconds:0}s");
                }

                await Task.Delay(100);
            }
        }
    }

    private static bool IsDialogRequested(byte[] bytes)
    {
        if (!Envelope.TryReadComplete(bytes, EnvelopeKind.BrowserEvent, out _, out var len) || len < 2)
        {
            return false;
        }

        var op = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(Envelope.HeaderBytes));
        return op == (ushort)ControlOpCode.DialogRequested;
    }

    private static async Task<List<byte[]>> ReceiveFramesAsync(ClientWebSocket client, int count, TimeSpan timeout)
    {
        var frames = new List<byte[]>();
        var buffer = new byte[256 * 1024];
        using var deadline = new CancellationTokenSource(timeout);

        try
        {
            while (frames.Count < count)
            {
                using var assembled = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await client.ReceiveAsync(buffer, deadline.Token);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        return frames;
                    }

                    assembled.Write(buffer, 0, result.Count);
                }
                while (!result.EndOfMessage);

                frames.Add(assembled.ToArray());
            }
        }
        catch (OperationCanceledException)
        {
            // devolve o que chegou; o chamador decide se foi suficiente
        }

        return frames;
    }

    private static async Task<List<byte[]>> ReceiveUntilAsync(
        ClientWebSocket client, TimeSpan timeout, Func<List<byte[]>, bool> done)
    {
        var frames = new List<byte[]>();
        var buffer = new byte[256 * 1024];
        using var deadline = new CancellationTokenSource(timeout);

        try
        {
            while (!done(frames))
            {
                using var assembled = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await client.ReceiveAsync(buffer, deadline.Token);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        return frames;
                    }

                    assembled.Write(buffer, 0, result.Count);
                }
                while (!result.EndOfMessage);

                frames.Add(assembled.ToArray());
            }
        }
        catch (OperationCanceledException)
        {
        }

        return frames;
    }

    private static int FirstIndexWithChildScope(IReadOnlyList<byte[]> frames, uint parentContext, uint childScope)
    {
        for (int i = 0; i < frames.Count; i++)
        {
            var h = SealedFrame.Parse(frames[i]);
            if (!h.Ok || h.ContextId != parentContext)
            {
                continue;
            }

            if (FrameNested.HasChildScope(frames[i], childScope))
            {
                return i;
            }
        }

        return -1;
    }

    private static int FirstIndexWithTextOnContext(IReadOnlyList<byte[]> frames, uint contextId, string needle)
    {
        for (int i = 0; i < frames.Count; i++)
        {
            var h = SealedFrame.Parse(frames[i]);
            if (!h.Ok || h.ContextId != contextId)
            {
                continue;
            }

            if (FrameStrings.TryReadLocal(frames[i], out var strings, out _) &&
                FrameStrings.Contains(strings, needle))
            {
                return i;
            }
        }

        return -1;
    }

    private static bool HasChildScope(IReadOnlyList<byte[]> frames, uint parentContext, uint childScope)
    {
        foreach (var frame in frames)
        {
            var h = SealedFrame.Parse(frame);
            if (!h.Ok || h.ContextId != parentContext)
            {
                continue;
            }

            if (FrameNested.HasChildScope(frame, childScope))
            {
                return true;
            }
        }

        return false;
    }

    private static bool HasTextOnContext(IReadOnlyList<byte[]> frames, uint contextId, string needle)
    {
        foreach (var frame in frames)
        {
            var h = SealedFrame.Parse(frame);
            if (!h.Ok || h.ContextId != contextId)
            {
                continue;
            }

            if (FrameStrings.TryReadLocal(frame, out var strings, out _) &&
                FrameStrings.Contains(strings, needle))
            {
                return true;
            }
        }

        return false;
    }

    private static uint? FirstGeneration(IReadOnlyList<byte[]> frames, uint contextId, string needle)
    {
        foreach (var frame in frames)
        {
            var h = SealedFrame.Parse(frame);
            if (!h.Ok || h.ContextId != contextId)
            {
                continue;
            }

            if (FrameStrings.TryReadLocal(frame, out var strings, out _) &&
                FrameStrings.Contains(strings, needle))
            {
                return h.Generation;
            }
        }

        return null;
    }

    private static int CountLog(string log, string needle)
    {
        var n = 0;
        var start = 0;
        while (true)
        {
            var i = log.IndexOf(needle, start, StringComparison.Ordinal);
            if (i < 0)
            {
                return n;
            }

            n++;
            start = i + needle.Length;
        }
    }

    private static bool FrameHasText(byte[] frame, string needle) =>
        SealedFrame.Parse(frame).Ok &&
        FrameStrings.TryReadLocal(frame, out var strings, out _) &&
        FrameStrings.Contains(strings, needle);

    private static void AssertPageText(Report report, byte[] frame, string needle, string where)
    {
        if (!FrameStrings.TryReadLocal(frame, out var strings, out var problem))
        {
            report.Fail($"tabela de strings ({where})", "decode.ts decodeFramePart", problem ?? "?");
            return;
        }

        report.Equal($"texto '{needle}' no frame ({where})", true, FrameStrings.Contains(strings, needle));
    }

    private static async Task SendConsumerNavigateAsync(ClientWebSocket client, string url)
    {
        // contextId 0 = "o contexto raiz"; o supervisor resolve. Mesmo ABI do doc 18.
        var command = ControlCommand.Navigate(0, 0, url);
        await client.SendAsync(command, WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);
    }

    private static async Task SendConsumerResyncAsync(ClientWebSocket client)
    {
        var command = ControlCommand.Resync(0, 0, 0);
        await client.SendAsync(command, WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);
    }

    private static async Task CloseAsync(ClientWebSocket client)
    {
        try
        {
            await client.CloseAsync(WebSocketCloseStatus.NormalClosure, "fim do teste", CancellationToken.None);
        }
        catch (WebSocketException)
        {
            // cortesia
        }
    }

    private static void StopSupervisor(Process supervisor)
    {
        try
        {
            if (!supervisor.HasExited)
            {
                supervisor.Kill(entireProcessTree: true);
                supervisor.WaitForExit(20000);
            }
        }
        catch (InvalidOperationException)
        {
            // já saiu
        }
        finally
        {
            supervisor.Dispose();
        }
    }

    private static void Append(StringBuilder log, string? line)
    {
        if (line is not null)
        {
            lock (log)
            {
                log.AppendLine(line);
            }
        }
    }

    private static int FreeTcpPort()
    {
        var listener = new TcpListener(System.Net.IPAddress.Loopback, 0);
        listener.Start();
        var port = ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static string SafeExit(Process process)
    {
        try
        {
            return process.ExitCode.ToString();
        }
        catch (InvalidOperationException)
        {
            return "?";
        }
    }

    /// <summary>
    /// Duas páginas locais de DOM distinto. A pilha não depende da internet, e
    /// o segundo salto só passa se o frame for de outro documento.
    /// </summary>
    private sealed class PageFixtures : IDisposable
    {
        private readonly HttpListener _listener;
        private readonly CancellationTokenSource _cancel = new();

        public string FirstUrl { get; }
        public string SecondUrl { get; }
        public string HostUrl { get; }
        public string Host2Url { get; }
        public string AlertUrl { get; }
        public string PixelUrl { get; }
        public string SvgUrl { get; }

        private PageFixtures(HttpListener listener, string firstUrl, string secondUrl,
            string hostUrl, string host2Url, string alertUrl, string pixelUrl, string svgUrl)
        {
            _listener = listener;
            FirstUrl = firstUrl;
            SecondUrl = secondUrl;
            HostUrl = hostUrl;
            Host2Url = host2Url;
            AlertUrl = alertUrl;
            PixelUrl = pixelUrl;
            SvgUrl = svgUrl;
            _ = ServeAsync(_cancel.Token);
        }

        public static PageFixtures Start()
        {
            var probe = new TcpListener(IPAddress.Loopback, 0);
            probe.Start();
            var port = ((IPEndPoint)probe.LocalEndpoint).Port;
            probe.Stop();

            var prefix = $"http://127.0.0.1:{port}/";
            var listener = new HttpListener();
            listener.Prefixes.Add(prefix);
            listener.Start();
            return new PageFixtures(listener, prefix + "a", prefix + "b", prefix + "host", prefix + "host2",
                prefix + "alert", prefix + "pixel.png", prefix + "logo.svg");
        }

        public void Dispose()
        {
            _cancel.Cancel();
            try
            {
                _listener.Stop();
            }
            catch (ObjectDisposedException)
            {
            }
            _listener.Close();
            _cancel.Dispose();
        }

        private async Task ServeAsync(CancellationToken cancel)
        {
            try
            {
                while (!cancel.IsCancellationRequested)
                {
                    var ctx = await _listener.GetContextAsync().WaitAsync(cancel);
                    var path = ctx.Request.Url?.AbsolutePath ?? "/";
                    if (path.EndsWith("/pixel.png", StringComparison.Ordinal))
                    {
                        var png = Convert.FromBase64String(
                            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");
                        ctx.Response.ContentType = "image/png";
                        ctx.Response.ContentLength64 = png.Length;
                        await ctx.Response.OutputStream.WriteAsync(png, cancel);
                        ctx.Response.Close();
                        continue;
                    }
                    if (path.EndsWith("/logo.svg", StringComparison.Ordinal))
                    {
                        var svg = Encoding.UTF8.GetBytes(
                            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"/>");
                        ctx.Response.ContentType = "image/svg+xml";
                        ctx.Response.ContentLength64 = svg.Length;
                        await ctx.Response.OutputStream.WriteAsync(svg, cancel);
                        ctx.Response.Close();
                        continue;
                    }

                    var body = path switch
                    {
                        var p when p.EndsWith("/alert", StringComparison.Ordinal) =>
                            "<!doctype html><html><head><title>spec-alert</title></head><body><p id=\"spec-alert\">wait</p>" +
                            "<script>alert('spec-ask');document.getElementById('spec-alert').textContent='answered';</script></body></html>",
                        var p when p.EndsWith("/b", StringComparison.Ordinal) =>
                            "<!doctype html><html><head><title>spec-b</title></head><body><h1 id=\"spec-page-b\">bravo</h1></body></html>",
                        var p when p.EndsWith("/inner2", StringComparison.Ordinal) =>
                            "<!doctype html><html><head><title>inner-b</title></head><body><p id=\"spec-inner-b\">inner-bravo</p></body></html>",
                        var p when p.EndsWith("/inner", StringComparison.Ordinal) =>
                            "<!doctype html><html><head><title>inner-a</title></head><body><p id=\"spec-inner-a\">inner-alpha</p></body></html>",
                        var p when p.EndsWith("/host2", StringComparison.Ordinal) =>
                            "<!doctype html><html><head><title>host2</title></head><body><iframe id=\"spec-frame-2\" src=\"/inner\"></iframe></body></html>",
                        var p when p.EndsWith("/host", StringComparison.Ordinal) =>
                            "<!doctype html><html><head><title>host</title></head><body>" +
                            "<iframe id=\"spec-frame\" src=\"/inner\"></iframe>" +
                            "<script>document.getElementById('spec-frame').addEventListener('load',function onFirst(){" +
                            "this.removeEventListener('load',onFirst);this.src='/inner2';});</script>" +
                            "</body></html>",
                        _ =>
                            "<!doctype html><html><head><title>spec-a</title></head><body><h1 id=\"spec-page-a\">alpha</h1>" +
                            "<button id=\"spec-go\">go</button><p id=\"spec-out\">idle</p>" +
                            "<script>window.addEventListener('load',function(){document.getElementById('spec-page-a').textContent='alpha-tick';});" +
                            "document.addEventListener('keydown',function(e){if(e.key==='x')document.getElementById('spec-out').textContent='clicked';});" +
                            "document.getElementById('spec-go').addEventListener('click',function(){document.getElementById('spec-out').textContent='clicked';});</script>" +
                            "</body></html>",
                    };
                    var bytes = Encoding.UTF8.GetBytes(body);
                    ctx.Response.ContentType = "text/html; charset=utf-8";
                    ctx.Response.ContentLength64 = bytes.Length;
                    await ctx.Response.OutputStream.WriteAsync(bytes, cancel);
                    ctx.Response.Close();
                }
            }
            catch (Exception) when (cancel.IsCancellationRequested)
            {
            }
            catch (HttpListenerException)
            {
            }
            catch (ObjectDisposedException)
            {
            }
        }
    }
}
