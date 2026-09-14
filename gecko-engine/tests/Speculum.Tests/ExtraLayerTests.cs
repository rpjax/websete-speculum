using System.Diagnostics;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using Speculum.Supervisor.Control;
using Speculum.Supervisor.Wire;

namespace Speculum.Tests;

/// <summary>
/// L3 extra: tee, L3-PP, input/viewport/history, marionete, ativos.
/// WiringTests (SPKF) permanece no papel wiring.
/// </summary>
public static class ExtraLayerTests
{
    public static async Task<int> RunAsync()
    {
        var report = new Report("L3 extra");
        Console.WriteLine("L3 extra — tee, PP, input, marionete, ativos");

        TeeUnit(report);
        await LayerAsync(report, "pp", PpAsync);
        await LayerAsync(report, "marionette", MarionetteAsync);
        await LayerAsync(report, "assets", AssetsAsync);

        return report.Finish();
    }

    private static void TeeUnit(Report report)
    {
        var tee = new StreamTee();
        var png = "PNG"u8.ToArray();
        tee.Apply(1, AssetPayload.PhaseChunk, 0, png);
        tee.Apply(1, AssetPayload.PhaseComplete, (ulong)png.Length, []);
        report.Bytes("tee reconstitui chunk", png, tee.Assemble(1));
        report.Equal("tee complete", true, tee.Complete(1));

        tee.Apply(2, AssetPayload.PhaseDenied, 0, "text/html"u8.ToArray());
        report.Equal("tee denied HTML", true, tee.Denied(2));
    }

    private static async Task PpAsync(Report report, Session s)
    {
        var frame = await ReceiveUntilAsync(s.Client, bytes => bytes.Length >= 4 && bytes[0] == 0x50 && bytes[1] == 0x50, TimeSpan.FromSeconds(15));
        report.Equal("L3-PP frame PP no WS", true, frame is not null);

        await s.Client.SendAsync(ControlCommand.HaltClocks(1), WebSocketMessageType.Binary, true, CancellationToken.None);
        report.Equal("Halt chega ao browser", true, await s.WaitJournal("halt", "", TimeSpan.FromSeconds(10)));

        await s.Client.SendAsync(ControlCommand.FlushFrame(2, 0), WebSocketMessageType.Binary, true, CancellationToken.None);
        report.Equal("Flush chega ao browser", true, await s.WaitJournal("flush", "", TimeSpan.FromSeconds(10)));

        await s.Client.SendAsync(ControlCommand.Snapshot(3, 0), WebSocketMessageType.Binary, true, CancellationToken.None);
        var snap = await ReceiveUntilAsync(s.Client, IsOpcode(ControlOpCode.SnapshotServed), TimeSpan.FromSeconds(10));
        report.Equal("SnapshotServed no WS", true, snap is not null);
        if (snap is not null)
        {
            var payload = UnwrapEvent(snap);
            var reader = new ControlReader(payload);
            report.Equal("SnapshotServed.opcode", ControlOpCode.SnapshotServed, reader.OpCode);
            report.Equal("SnapshotServed.correlationId", 3u, reader.CorrelationId);
            reader.ReadUInt32();
            reader.ReadUInt32();
            reader.ReadUInt32();
            reader.ReadUInt64();
            var dump = reader.ReadBytes();
            report.Equal("dump >= 24", true, dump.Length >= 24);
        }

        await s.Client.SendAsync(ControlCommand.Input(4, 0, [0x01, 0x02]), WebSocketMessageType.Binary, true, CancellationToken.None);
        report.Equal("input admitido", true, await s.WaitJournal("input", "admit", TimeSpan.FromSeconds(10)));

        await s.Client.SendAsync(ControlCommand.ViewportSet(5, 0, 1024, 768), WebSocketMessageType.Binary, true, CancellationToken.None);
        report.Equal("viewport no diário", true, await s.WaitJournal("viewport", "1024", TimeSpan.FromSeconds(10)));

        await s.Client.SendAsync(ControlCommand.HistoryGo(6, 0, -1), WebSocketMessageType.Binary, true, CancellationToken.None);
        var historyOk = await s.WaitJournal("history", "go", TimeSpan.FromSeconds(10));
        if (!historyOk)
        {
            Console.WriteLine("--- diário pp (history) ---");
            Console.WriteLine(ReadAllShared(s.JournalPath));
        }

        report.Equal("history no diário", true, historyOk);

        await s.Client.SendAsync(ControlCommand.ResumeClocks(7), WebSocketMessageType.Binary, true, CancellationToken.None);
        report.Equal("resume no diário", true, await s.WaitJournal("resume", "", TimeSpan.FromSeconds(10)));

        await s.Client.SendAsync(ControlCommand.Reload(8, 0), WebSocketMessageType.Binary, true, CancellationToken.None);
        report.Equal("reload no diário", true, await s.WaitJournal("reload", "", TimeSpan.FromSeconds(10)));

        await s.Client.SendAsync(ControlCommand.Stop(9, 0), WebSocketMessageType.Binary, true, CancellationToken.None);
        report.Equal("stop no diário", true, await s.WaitJournal("stop", "", TimeSpan.FromSeconds(10)));

        await s.Client.SendAsync(ControlCommand.Input(10, 0, [0x20, 0x00]), WebSocketMessageType.Binary, true, CancellationToken.None);
        report.Equal("pointermove rejeitado", true, await s.WaitJournal("input", "reject", TimeSpan.FromSeconds(10)));
    }

    private static async Task MarionetteAsync(Report report, Session s)
    {
        var dialog = await ReceiveUntilAsync(s.Client, IsOpcode(ControlOpCode.DialogRequested), TimeSpan.FromSeconds(15));
        report.Equal("DialogRequested no WS", true, dialog is not null);
        if (dialog is null)
        {
            return;
        }

        var payload = UnwrapEvent(dialog);
        var reader = new ControlReader(payload);
        var ctx = reader.ReadUInt32();
        var requestId = reader.ReadUInt32();
        await s.Client.SendAsync(
            ControlCommand.DialogRespond(1, ctx, requestId, "ok"u8.ToArray()),
            WebSocketMessageType.Binary, true, CancellationToken.None);
        report.Equal("DialogRespond chega", true, await s.WaitJournal("dialog-respond", "", TimeSpan.FromSeconds(10)));
        report.Equal("silêncio não é ok", true, !(await s.WaitJournal("dialog-auto-ok", "", TimeSpan.FromMilliseconds(200))));
    }

    private static async Task AssetsAsync(Report report, Session s)
    {
        var chunk = await ReceiveUntilAsync(s.Client, IsKind(EnvelopeKind.Asset, AssetPayload.PhaseChunk), TimeSpan.FromSeconds(15));
        report.Equal("asset chunk no WS", true, chunk is not null);
        var denied = await ReceiveUntilAsync(s.Client, IsKind(EnvelopeKind.Asset, AssetPayload.PhaseDenied), TimeSpan.FromSeconds(10));
        report.Equal("HTML denied no WS", true, denied is not null);
        if (denied is not null)
        {
            var body = UnwrapKind(denied);
            var decoded = AssetPayload.Decode(body);
            report.Equal("denied phase", AssetPayload.PhaseDenied, decoded.Phase);
        }
    }

    private sealed class Session
    {
        public required ClientWebSocket Client { get; init; }
        public required string JournalPath { get; init; }

        public async Task<bool> WaitJournal(string key, string contains, TimeSpan timeout)
        {
            var deadline = DateTime.UtcNow + timeout;
            while (DateTime.UtcNow < deadline)
            {
                if (JournalHas(JournalPath, key, contains))
                {
                    return true;
                }

                await Task.Delay(50);
            }

            return JournalHas(JournalPath, key, contains);
        }
    }

    private static async Task LayerAsync(Report report, string mode, Func<Report, Session, Task> body)
    {
        if (!Harness.TryDotnet(out var dotnet, out var pDot))
        {
            report.Fail($"dotnet ({mode})", "SPECULUM_DOTNET", pDot);
            return;
        }

        if (!Harness.TryDll("SPECULUM_SUPERVISOR_DLL", out var supervisorDll, out var pSup))
        {
            report.Fail($"supervisor ({mode})", "SPECULUM_SUPERVISOR_DLL", pSup);
            return;
        }

        if (!Harness.TryDll("SPECULUM_TESTS_DLL", out var testsDll, out var pTests))
        {
            report.Fail($"tests ({mode})", "SPECULUM_TESTS_DLL", pTests);
            return;
        }

        var wrapper = Harness.WriteFakeBrowserWrapper(dotnet, testsDll);
        var port = FreeTcpPort();
        var socketPath = $"/tmp/spec-l3x-{Guid.NewGuid():n}"[..24] + ".sock";
        var journalPath = Path.Combine(Path.GetTempPath(), $"spec-l3x-{mode}-{Guid.NewGuid():n}.txt");
        File.Delete(socketPath);
        File.Delete(journalPath);
        var log = new StringBuilder();
        var supervisor = StartSupervisor(dotnet, supervisorDll, wrapper, port, socketPath, journalPath, mode, log);
        try
        {
            using var client = await ConnectAsync(port, supervisor, TimeSpan.FromSeconds(15));
            await body(report, new Session { Client = client, JournalPath = journalPath });
            await CloseAsync(client);
        }
        catch (Exception ex)
        {
            report.Fail($"L3 extra {mode}", "roteiro completo", ex.Message);
            Console.WriteLine(log.ToString());
            if (File.Exists(journalPath))
            {
                Console.WriteLine(ReadAllShared(journalPath));
            }
        }
        finally
        {
            Stop(supervisor);
            File.Delete(socketPath);
            File.Delete(journalPath);
            try { File.Delete(wrapper); } catch (IOException) { }
        }
    }

    private static Process StartSupervisor(
        string dotnet, string supervisorDll, string browserBin, int port, string socketPath,
        string journalPath, string mode, StringBuilder log)
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
        info.Environment["SPECULUM_BROWSER_URL"] = "https://wiring.test/extra";
        info.Environment["SPECULUM_SUPERVISOR_PORT"] = port.ToString();
        info.Environment["SPECULUM_BROWSER_SOCKET"] = socketPath;
        info.Environment["SPECULUM_TESTS_ROLE"] = "fake-browser";
        info.Environment["SPECULUM_FAKE_JOURNAL"] = journalPath;
        info.Environment["SPECULUM_FAKE_MODE"] = mode;
        var cli = Environment.GetEnvironmentVariable("SPECULUM_PRODUCER_CLI");
        if (!string.IsNullOrEmpty(cli))
        {
            info.Environment["SPECULUM_PRODUCER_CLI"] = cli;
        }

        var frames = Environment.GetEnvironmentVariable("SPECULUM_PP_FRAMES_DIR");
        if (!string.IsNullOrEmpty(frames))
        {
            info.Environment["SPECULUM_PP_FRAMES_DIR"] = frames;
        }
        var process = new Process { StartInfo = info, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) lock (log) log.AppendLine(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) lock (log) log.AppendLine(e.Data); };
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        return process;
    }

    private static async Task<ClientWebSocket> ConnectAsync(int port, Process supervisor, TimeSpan timeout)
    {
        var uri = new Uri($"ws://127.0.0.1:{port}/session");
        var deadline = DateTime.UtcNow + timeout;
        while (true)
        {
            if (supervisor.HasExited)
            {
                throw new InvalidOperationException($"supervisor saiu ({SafeExit(supervisor)})");
            }

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
                    throw new TimeoutException($"não conectou em {uri}");
                }

                await Task.Delay(100);
            }
        }
    }

    private static async Task<byte[]?> ReceiveUntilAsync(ClientWebSocket client, Func<byte[], bool> match, TimeSpan timeout)
    {
        var buffer = new byte[64 * 1024];
        using var deadline = new CancellationTokenSource(timeout);
        try
        {
            while (true)
            {
                using var assembled = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await client.ReceiveAsync(buffer, deadline.Token);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        return null;
                    }

                    assembled.Write(buffer, 0, result.Count);
                }
                while (!result.EndOfMessage);

                var bytes = assembled.ToArray();
                if (match(bytes))
                {
                    return bytes;
                }
            }
        }
        catch (OperationCanceledException)
        {
            return null;
        }
    }

    private static Func<byte[], bool> IsOpcode(ControlOpCode op) => bytes =>
    {
        try
        {
            var payload = UnwrapEvent(bytes);
            return new ControlReader(payload).OpCode == op;
        }
        catch (Exception)
        {
            return false;
        }
    };

    private static Func<byte[], bool> IsKind(EnvelopeKind kind, byte phase) => bytes =>
    {
        if (bytes.Length < Envelope.HeaderBytes || bytes[0] != (byte)kind)
        {
            return false;
        }

        try
        {
            var body = UnwrapKind(bytes);
            return AssetPayload.Decode(body).Phase == phase;
        }
        catch (Exception)
        {
            return false;
        }
    };

    private static byte[] UnwrapEvent(byte[] bytes)
    {
        if (bytes.Length >= Envelope.HeaderBytes && bytes[0] == (byte)EnvelopeKind.BrowserEvent)
        {
            return UnwrapKind(bytes);
        }

        return bytes;
    }

    private static byte[] UnwrapKind(byte[] bytes)
    {
        var (_, _, length) = Envelope.ReadHeader(bytes);
        var body = new byte[length];
        Buffer.BlockCopy(bytes, Envelope.HeaderBytes, body, 0, length);
        return body;
    }

    private static bool JournalHas(string path, string key, string contains)
    {
        if (!File.Exists(path))
        {
            return false;
        }

        foreach (var line in ReadAllShared(path).Split('\n'))
        {
            var parts = line.Split('|', 2);
            if (parts[0] != key)
            {
                continue;
            }

            if (contains.Length == 0 || (parts.Length > 1 && parts[1].Contains(contains, StringComparison.Ordinal)))
            {
                return true;
            }
        }

        return false;
    }

    private static string ReadAllShared(string path)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using var reader = new StreamReader(fs);
        return reader.ReadToEnd();
    }

    private static async Task CloseAsync(ClientWebSocket client)
    {
        try
        {
            await client.CloseAsync(WebSocketCloseStatus.NormalClosure, "fim", CancellationToken.None);
        }
        catch (WebSocketException)
        {
        }
    }

    private static void Stop(Process supervisor)
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
        }
        finally
        {
            supervisor.Dispose();
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
        try { return process.ExitCode.ToString(); }
        catch (InvalidOperationException) { return "?"; }
    }
}
