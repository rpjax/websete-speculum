using System.Diagnostics;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using Speculum.Supervisor.Control;

namespace Speculum.Tests;

/// <summary>
/// L3 — a amarração (doc 19 §3, §5).
///
/// Sobe o supervisor DE PRODUÇÃO, sem alteração nenhuma, apontando o
/// SPECULUM_BROWSER_BIN para o próprio binário de teste em papel de browser
/// falso. Conecta um consumidor real no plano de consumo. Então prova o roteiro
/// inteiro do doc 19 §5, cruzando duas testemunhas independentes:
///
///   • o diário do browser falso — o que o motor viu e respondeu;
///   • os frames no WebSocket — o que o supervisor de fato entregou ao consumidor.
///
/// Se as duas concordam, a costura está provada de ponta a ponta, menos o Gecko.
/// É a propriedade do doc 19 §5: L3 passando e L4 falhando ⇒ o defeito está no
/// Gecko e em lugar nenhum mais.
///
/// Quando qualquer passo falha, o log do supervisor e o diário inteiro são
/// despejados — o veredito basta, não há investigação (doc 19 §1).
/// </summary>
public static class WiringTests
{
    private const string BootUrl = "https://wiring.test/l3";
    private const string ConsumerUrl = "https://wiring.test/l3/consumer-nav";
    private const int FramesToCollect = 5;

    public static async Task<int> RunAsync()
    {
        var report = new Report("L3 amarração");
        Console.WriteLine("L3 — amarração (supervisor real + browser falso + consumidor real)");

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

        if (!Harness.TryDll("SPECULUM_TESTS_DLL", out var testsDll, out var pTests))
        {
            report.Fail("dll de teste", "SPECULUM_TESTS_DLL construída", pTests, "rode pelo run.sh");
            return report.Finish();
        }

        // O browser falso é este mesmo binário, chamado pelo muxer via um wrapper
        // de uma linha — porque o supervisor lança o browser como executável único.
        var wrapper = Harness.WriteFakeBrowserWrapper(dotnet, testsDll);

        var port = FreeTcpPort();
        var socketPath = $"/tmp/spec-l3-{Guid.NewGuid():n}"[..24] + ".sock";
        var journalPath = Path.Combine(Path.GetTempPath(), $"spec-l3-journal-{Guid.NewGuid():n}.txt");
        File.Delete(socketPath);
        File.Delete(journalPath);

        var log = new StringBuilder();
        var supervisor = StartSupervisor(dotnet, supervisorDll, wrapper, port, socketPath, journalPath, log);

        try
        {
            // Dois consumidores: prova o leque de distribuição (doc 19 §5, §8).
            // Os dois têm que receber os mesmos frames, do mesmo contexto.
            using var clientA = await ConnectConsumerAsync(port, supervisor, TimeSpan.FromSeconds(15));
            using var clientB = await ConnectConsumerAsync(port, supervisor, TimeSpan.FromSeconds(15));

            // (bootstrap) o supervisor pede contexto e navega sozinho; a chegada
            // dos frames prova a corrente Ready→ContextCreated→Navigated inteira.
            var framesA = await ReceiveFramesAsync(clientA, FramesToCollect, TimeSpan.FromSeconds(15));
            AssertFrames(report, "A", framesA);

            var framesB = await ReceiveFramesAsync(clientB, FramesToCollect, TimeSpan.FromSeconds(15));
            AssertFrames(report, "B", framesB);
            report.Equal("leque: os dois consumidores recebem frames", true,
                framesA.Count >= 1 && framesB.Count >= 1);

            // o diário confirma o handshake do lado do motor, com a URL de boot.
            var boot = ReadJournal(journalPath);
            AssertBootJournal(report, boot);

            // (comando de consumidor) o consumidor pede navegação; o supervisor
            // resolve contextId 0 → raiz e manda ao browser. Provamos lendo o
            // diário até a navegação pedida aparecer — o caminho consumidor →
            // supervisor → browser, ponta a ponta, sem Gecko.
            await SendConsumerNavigateAsync(clientA, ConsumerUrl);
            var delivered = await WaitForJournalAsync(
                journalPath, "navigate", ConsumerUrl, TimeSpan.FromSeconds(10));
            report.Equal("navegação do consumidor chega ao browser", true, delivered);

            await CloseAsync(clientA);
            await CloseAsync(clientB);

            // (caiu = morre, doc 15) mata o browser e prova que o supervisor
            // encerra SOZINHO — sem ninguém pedir. A ponte é o link vital.
            AssertBrowserDeathKillsSupervisor(report, boot, supervisor);
        }
        catch (Exception ex)
        {
            report.Fail("execução da sessão", "roteiro completo", ex.Message);
        }
        finally
        {
            StopSupervisor(supervisor);
        }

        if (report.Failed)
        {
            DumpDiagnostics(log, journalPath);
        }

        File.Delete(socketPath);
        File.Delete(journalPath);
        try { File.Delete(wrapper); } catch (IOException) { /* wrapper temporário */ }
        return report.Finish();
    }

    private static Process StartSupervisor(
        string dotnet, string supervisorDll, string browserBin, int port, string socketPath, string journalPath, StringBuilder log)
    {
        var info = new ProcessStartInfo(dotnet)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Path.GetDirectoryName(supervisorDll) ?? ".",
        };
        info.ArgumentList.Add(supervisorDll);

        // O caller sobe o supervisor como o lab (SessionHost). O browser é o
        // wrapper que relança este binário como browser falso; o papel e o diário
        // viajam pelo ambiente, herdados pelo wrapper e pelo dotnet que ele chama.
        info.Environment["SPECULUM_BROWSER_BIN"] = browserBin;
        info.Environment["SPECULUM_BROWSER_URL"] = BootUrl;
        info.Environment["SPECULUM_SUPERVISOR_PORT"] = port.ToString();
        info.Environment["SPECULUM_BROWSER_SOCKET"] = socketPath;
        info.Environment["SPECULUM_TESTS_ROLE"] = "fake-browser";
        info.Environment["SPECULUM_FAKE_JOURNAL"] = journalPath;

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
                    throw new TimeoutException($"consumidor não conseguiu conectar em {uri} em {timeout.TotalSeconds:0}s");
                }

                await Task.Delay(100);
            }
        }
    }

    private static async Task<List<byte[]>> ReceiveFramesAsync(ClientWebSocket client, int count, TimeSpan timeout)
    {
        var frames = new List<byte[]>();
        var buffer = new byte[64 * 1024];
        using var deadline = new CancellationTokenSource(timeout);

        while (frames.Count < count)
        {
            using var assembled = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await client.ReceiveAsync(buffer, deadline.Token);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    throw new InvalidOperationException("supervisor fechou o WebSocket do consumidor");
                }

                assembled.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            frames.Add(assembled.ToArray());
        }

        return frames;
    }

    private static void AssertFrames(Report report, string who, List<byte[]> frames)
    {
        report.Equal($"[{who}] frames recebidos", FramesToCollect, frames.Count);

        var expectedBlob = FakeFrame.Blob();
        ulong? previousSeq = null;

        for (var i = 0; i < frames.Count; i++)
        {
            var parsed = FakeFrame.Parse(frames[i]);
            if (!parsed.Ok)
            {
                report.Fail($"[{who}] frame {i} bem formado", "magic+ctx+seq+blob", parsed.Problem ?? "?", Report.Hex(frames[i]));
                continue;
            }

            report.Equal($"[{who}] frame {i}: contextId", 1u, parsed.ContextId);
            report.Bytes($"[{who}] frame {i}: blob íntegro", expectedBlob, parsed.Blob);

            if (previousSeq is { } prev)
            {
                if (parsed.Sequence == prev + 1)
                {
                    report.Pass($"[{who}] frame {i}: sequência {parsed.Sequence} = anterior+1");
                }
                else
                {
                    report.Fail($"[{who}] frame {i}: sequência contígua", $"{prev + 1}", $"{parsed.Sequence}");
                }
            }

            previousSeq = parsed.Sequence;
        }
    }

    /// <summary>
    /// Mata o processo do browser falso e prova que o supervisor encerra sozinho.
    /// A ponte de controle é o link vital (doc 15/17): ela cai, tudo cai. O
    /// supervisor não pode ficar vivo pendurado num browser morto.
    /// </summary>
    private static void AssertBrowserDeathKillsSupervisor(
        Report report, Dictionary<string, string> boot, Process supervisor)
    {
        if (!boot.TryGetValue("pid", out var pidText) || !int.TryParse(pidText, out var pid))
        {
            report.Fail("caiu = morre", "pid do browser falso no diário", "ausente");
            return;
        }

        try
        {
            using var browser = Process.GetProcessById(pid);
            browser.Kill();
        }
        catch (ArgumentException)
        {
            // já morreu — o efeito que queremos provar já vale
        }

        var exited = supervisor.WaitForExit(10000);
        report.Equal("browser morto ⇒ supervisor encerra sozinho", true, exited);
    }

    private static void AssertBootJournal(Report report, Dictionary<string, string> entries)
    {
        if (entries.Count == 0)
        {
            report.Fail("diário do browser falso", "eventos registrados", "vazio — o browser falso nem rodou");
            return;
        }

        RequireEntry(report, entries, "connected", null);
        RequireEntry(report, entries, "ready", null);
        RequireEntry(report, entries, "context-create", "ctx=1 w=1280 h=800");
        RequireEntry(report, entries, "context-created", null);
        RequireEntry(report, entries, "navigate", $"ctx=1 url={BootUrl}");
        RequireEntry(report, entries, "navigated", null);
        RequireEntry(report, entries, "frames-started", "ctx=1");
    }

    private static void RequireEntry(Report report, Dictionary<string, string> entries, string key, string? expectedDetail)
    {
        if (!entries.TryGetValue(key, out var detail))
        {
            report.Fail($"diário: {key}", expectedDetail ?? "presente", "ausente");
            return;
        }

        if (expectedDetail is not null && !detail.Equals(expectedDetail, StringComparison.Ordinal))
        {
            report.Fail($"diário: {key}", expectedDetail, detail);
            return;
        }

        report.Pass($"diário: {key}{(expectedDetail is null ? "" : $" ({detail})")}");
    }

    private static async Task SendConsumerNavigateAsync(ClientWebSocket client, string url)
    {
        // contextId 0 = "o contexto raiz"; quem resolve é o supervisor. Mesmo ABI
        // do doc 18 que um consumidor de produção usaria.
        var command = ControlCommand.Navigate(0, 0, url);
        await client.SendAsync(command, WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);
    }

    private static async Task<bool> WaitForJournalAsync(string journalPath, string key, string expectedDetail, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            var entries = ReadJournal(journalPath);
            if (entries.TryGetValue(key, out var detail) && detail.EndsWith($"url={expectedDetail}", StringComparison.Ordinal))
            {
                return true;
            }

            await Task.Delay(100);
        }

        return false;
    }

    private static Dictionary<string, string> ReadJournal(string journalPath)
    {
        var entries = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!File.Exists(journalPath))
        {
            return entries;
        }

        // O browser falso escreve concorrentemente; ler com compartilhamento evita
        // corrida com o append.
        using var fs = new FileStream(journalPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using var sr = new StreamReader(fs);
        string? line;
        while ((line = sr.ReadLine()) is not null)
        {
            var parts = line.Split('|', 2);
            if (parts.Length == 2)
            {
                entries[parts[0]] = parts[1];
            }
        }

        return entries;
    }

    private static void DumpDiagnostics(StringBuilder log, string journalPath)
    {
        Console.WriteLine();
        Console.WriteLine("---- log do supervisor + browser falso ----");
        Console.WriteLine(log.ToString().TrimEnd());
        Console.WriteLine("---- diário do browser falso ----");
        Console.WriteLine(File.Exists(journalPath) ? File.ReadAllText(journalPath).TrimEnd() : "(sem diário)");
        Console.WriteLine("-------------------------------------------");
    }

    private static async Task CloseAsync(ClientWebSocket client)
    {
        try
        {
            await client.CloseAsync(WebSocketCloseStatus.NormalClosure, "fim do teste", CancellationToken.None);
        }
        catch (WebSocketException)
        {
            // fechar é cortesia; se o supervisor já foi, tudo bem
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
}
