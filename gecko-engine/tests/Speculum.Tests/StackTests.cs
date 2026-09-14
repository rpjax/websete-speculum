using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using Speculum.Supervisor.Control;

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
            return await RunWithPagesAsync(report, pages);
        }
        finally
        {
            pages.Dispose();
        }
    }

    private static async Task<int> RunWithPagesAsync(Report report, PageFixtures pages)
    {
        var browserBin = Environment.GetEnvironmentVariable("SPECULUM_STACK_BROWSER_BIN");
        var url = Environment.GetEnvironmentVariable("SPECULUM_STACK_URL") ?? pages.FirstUrl;
        var secondUrl = Environment.GetEnvironmentVariable("SPECULUM_STACK_URL2") ?? pages.SecondUrl;

        if (!Harness.TryDotnet(out var dotnet, out var pDot))
        {
            report.Fail("dotnet", "SPECULUM_DOTNET válido", pDot, "rode pelo run.sh");
            return report.Finish();
        }

        if (!Harness.TryDll("SPECULUM_SUPERVISOR_DLL", out var supervisorDll, out var pSup))
        {
            report.Fail("dll do supervisor", "SPECULUM_SUPERVISOR_DLL construída", pSup, "rode pelo run.sh");
            return report.Finish();
        }

        if (string.IsNullOrWhiteSpace(browserBin) || !File.Exists(browserBin))
        {
            report.Fail("binário do Gecko", "SPECULUM_STACK_BROWSER_BIN apontando para o firefox construído",
                browserBin ?? "não definida", "L4 exige a stack real; rode run.sh --stack com o objdir construído");
            return report.Finish();
        }

        var port = FreeTcpPort();
        var socketPath = $"/tmp/spec-l4-{Guid.NewGuid():n}"[..24] + ".sock";
        File.Delete(socketPath);

        var log = new StringBuilder();
        var supervisor = StartSupervisor(dotnet, supervisorDll, browserBin, url, port, socketPath, log);

        try
        {
            using var client = await ConnectConsumerAsync(port, supervisor, TimeSpan.FromSeconds(60));

            // (2)(3)(4): o supervisor pede contexto e navega sozinho; a chegada do
            // frame prova a corrente Ready→ContextCreated→Navigated inteira. Uma
            // página estática emite UM frame de bootstrap e para (sem mutação, sem
            // mais frames), então pedimos 1 — pedir mais faria o receive estourar o
            // timeout, e cancelar um ReceiveAsync ABORTA o WebSocket.
            var first = await ReceiveFramesAsync(client, count: 1, TimeSpan.FromSeconds(60));
            report.Equal("frames reais recebidos (bootstrap)", true, first.Count >= 1);

            uint rootContext = 0;
            var contexts = new HashSet<uint>();
            for (var i = 0; i < first.Count; i++)
            {
                var h = SealedFrame.Parse(first[i]);
                if (!h.Ok)
                {
                    report.Fail($"frame {i}: prefixo selado", "magic 0x5050 version 2", h.Problem ?? "?",
                        Report.Hex(first[i].AsSpan(0, Math.Min(SealedFrame.PrefixBytes, first[i].Length))));
                    continue;
                }

                report.Pass($"frame {i}: prefixo selado (ctx={h.ContextId} gen={h.Generation} seq={h.Sequence})");
                contexts.Add(h.ContextId);
                if (rootContext == 0)
                {
                    rootContext = h.ContextId;
                }
            }

            // (4): um contexto só no bootstrap. Vários = o pai carimbou contextos
            // demais (a suspeita chrome-vs-conteúdo apareceria aqui).
            report.Equal("contextos distintos no bootstrap", 1, contexts.Count);
            report.Equal("contextId é o raiz da sessão", 1u, rootContext);

            if (first.Count >= 1)
            {
                AssertPageText(report, first[0], "alpha", "bootstrap (página /a)");
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
        return report.Finish();
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
                supervisor.WaitForExit(5000);
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

        private PageFixtures(HttpListener listener, string firstUrl, string secondUrl)
        {
            _listener = listener;
            FirstUrl = firstUrl;
            SecondUrl = secondUrl;
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
            return new PageFixtures(listener, prefix + "a", prefix + "b");
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
                    var body = path.EndsWith("/b", StringComparison.Ordinal)
                        ? "<!doctype html><html><head><title>spec-b</title></head><body><h1 id=\"spec-page-b\">bravo</h1></body></html>"
                        : "<!doctype html><html><head><title>spec-a</title></head><body><h1 id=\"spec-page-a\">alpha</h1></body></html>";
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
