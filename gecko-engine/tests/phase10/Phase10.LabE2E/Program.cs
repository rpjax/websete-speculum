using System.Buffers.Binary;
using System.Diagnostics;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using Speculum.Supervisor.Control;
using Speculum.Supervisor.Wire;
using Speculum.Wire;

// Phase 10 A5 — real SessionHost + schema FakeMotor + consumer WS.
// Env (all explicit — no path walking):
//   SPECULUM_DOTNET
//   SPECULUM_SUPERVISOR_DLL   (speculum-supervisor.dll)
//   SPECULUM_PHASE10_FAKE_DLL (this same assembly, role=fake-motor)
// Timeout = red.

if (string.Equals(Environment.GetEnvironmentVariable("SPECULUM_TESTS_ROLE"), "fake-motor",
        StringComparison.Ordinal))
{
    return await SchemaFakeMotor.RunAsync();
}

return await LabE2E.RunAsync();

static class LabE2E
{
    const int TimeoutMs = 45_000;

    public static async Task<int> RunAsync()
    {
        var fails = 0;
        void Check(bool ok, string name)
        {
            if (ok) Console.WriteLine("PASS " + name);
            else { Console.WriteLine("FAIL " + name); fails++; }
        }

        var dotnet = EnvFile("SPECULUM_DOTNET");
        var supervisorDll = EnvFile("SPECULUM_SUPERVISOR_DLL");
        var selfDll = EnvFile("SPECULUM_PHASE10_FAKE_DLL");
        var counts = new Counts();
        var journal = Path.Combine(Path.GetTempPath(), $"phase10-journal-{Guid.NewGuid():n}.log");
        var socket = Path.Combine(Path.GetTempPath(), $"phase10-sock-{Guid.NewGuid():n}.sock");
        var port = 4110 + Random.Shared.Next(80);

        var fakeWrapper = WriteFakeWrapper(dotnet, selfDll);
        try
        {
            using var cts = new CancellationTokenSource(TimeoutMs);
            var supervisor = StartSupervisor(dotnet, supervisorDll, fakeWrapper, socket, port, journal);
            try
            {
                // Connect before Ready→Navigate so the Navigate Patch is not broadcast into the void.
                await WaitPortAsync(port, cts.Token);
                using var ws = new ClientWebSocket();
                await ws.ConnectAsync(new Uri($"ws://127.0.0.1:{port}/session"), cts.Token);

                var pump = PumpConsumerAsync(ws, counts, cts.Token);

                await WaitJournalAsync(journal, "ready", cts.Token);
                await WaitJournalAsync(journal, "navigated", cts.Token);
                await WaitUntilAsync(() => counts.Patches == 1, cts.Token, "patch after Navigate");

                // Exactly one Resync → exactly one more Patch (total 2).
                const int ExpectedPatches = 2;
                await SendAsync(ws, SchemaCommands.Resync(2, 0, ResyncForce.FromWalk), cts.Token);
                await WaitUntilAsync(() => counts.Patches == ExpectedPatches, cts.Token, "patches after Resync");

                await SendAsync(ws,
                    SchemaEnvelope.Pack(
                        OpInputPointerDown.Code,
                        1,
                        Codecs.EncodeInputPointerDownBytes(new InputPointerDown
                        {
                            generation = 1,
                            node = 1,
                            localX = 10,
                            localY = 20,
                            button = MouseButton.Left,
                        }),
                        3),
                    cts.Token);
                await WaitJournalAsync(journal, "input", cts.Token);

                await SendAsync(ws, SchemaCommands.Shutdown(4), cts.Token);
                await WaitJournalAsync(journal, "shutdown", cts.Token);

                cts.Cancel();
                try { await pump; } catch (OperationCanceledException) { }

                var journalText = await File.ReadAllTextAsync(journal);
                Check(journalText.Contains("viewport-open", StringComparison.Ordinal), "A5 ViewportOpen exercised");
                Check(journalText.Contains("navigated", StringComparison.Ordinal), "A5 Navigate exercised");
                Check(counts.Patches == ExpectedPatches,
                    $"A5 patches exercised count={counts.Patches} expected={ExpectedPatches}");
                Check(journalText.Contains("input", StringComparison.Ordinal), "A5 Input exercised");
                Check(journalText.Contains("shutdown", StringComparison.Ordinal), "A5 Shutdown exercised");
            }
            finally
            {
                TryKill(supervisor);
            }
        }
        catch (OperationCanceledException)
        {
            Console.WriteLine("FAIL A5 timeout (explicit) — session did not complete in " + TimeoutMs + "ms");
            if (File.Exists(journal))
                Console.WriteLine("JOURNAL:\n" + File.ReadAllText(journal));
            fails++;
        }
        catch (Exception ex)
        {
            Console.WriteLine("FAIL A5 " + ex.Message);
            if (File.Exists(journal))
                Console.WriteLine("JOURNAL:\n" + File.ReadAllText(journal));
            fails++;
        }
        finally
        {
            TryDelete(fakeWrapper);
            TryDelete(journal);
            TryDelete(socket);
        }

        Console.WriteLine(fails == 0 ? "phase10-lab-e2e PASS" : $"phase10-lab-e2e FAIL ({fails})");
        return fails == 0 ? 0 : 1;
    }

    static string EnvFile(string name)
    {
        var v = Environment.GetEnvironmentVariable(name);
        if (string.IsNullOrWhiteSpace(v) || !File.Exists(v))
        {
            throw new InvalidOperationException($"{name} must point to an existing file");
        }
        return v;
    }

    static string WriteFakeWrapper(string dotnet, string dll)
    {
        var path = Path.Combine(Path.GetTempPath(), $"phase10-fake-{Guid.NewGuid():n}.sh");
        File.WriteAllText(path,
            "#!/bin/sh\n" +
            $"export SPECULUM_TESTS_ROLE=fake-motor\n" +
            $"exec \"{dotnet}\" \"{dll}\" \"$@\"\n");
        if (OperatingSystem.IsLinux() || OperatingSystem.IsMacOS())
        {
            File.SetUnixFileMode(path,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute |
                UnixFileMode.GroupRead | UnixFileMode.GroupExecute |
                UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
        }
        return path;
    }

    static Process StartSupervisor(string dotnet, string dll, string browser, string socket, int port, string journal)
    {
        var info = new ProcessStartInfo(dotnet)
        {
            ArgumentList = { dll },
            UseShellExecute = false,
        };
        info.Environment["SPECULUM_BROWSER_BIN"] = browser;
        info.Environment["SPECULUM_BROWSER_SOCKET"] = socket;
        info.Environment["SPECULUM_BROWSER_URL"] = "https://phase10.test/";
        info.Environment["SPECULUM_SUPERVISOR_PORT"] = port.ToString();
        info.Environment["SPECULUM_BROWSER_HEADLESS"] = "1";
        info.Environment["SPECULUM_CAP_EVENTS"] = "1";
        info.Environment["SPECULUM_CAP_METRICS"] = "0";
        info.Environment["SPECULUM_FAKE_JOURNAL"] = journal;
        info.Environment["SPECULUM_SCHEMA_SHA256"] = SchemaMeta.Sha256;
        var p = Process.Start(info) ?? throw new InvalidOperationException("supervisor start failed");
        return p;
    }

    static async Task SendAsync(ClientWebSocket ws, byte[] frame, CancellationToken ct)
    {
        await ws.SendAsync(frame, WebSocketMessageType.Binary, true, ct);
    }

    static async Task PumpConsumerAsync(ClientWebSocket ws, Counts counts, CancellationToken ct)
    {
        var buf = new byte[256 * 1024];
        while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
        {
            using var ms = new MemoryStream();
            WebSocketReceiveResult r;
            do
            {
                r = await ws.ReceiveAsync(buf, ct);
                if (r.MessageType == WebSocketMessageType.Close) return;
                ms.Write(buf, 0, r.Count);
            } while (!r.EndOfMessage);

            var frame = ms.ToArray();
            if (frame.Length >= SchemaEnvelope.HeaderBytes)
            {
                var (op, _, _, _) = SchemaEnvelope.ReadHeader(frame);
                if (op == OpPatch.Code) Interlocked.Increment(ref counts.Patches);
            }
        }
    }

    static async Task WaitPortAsync(int port, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var c = new TcpClient();
                await c.ConnectAsync(System.Net.IPAddress.Loopback, port, ct);
                return;
            }
            catch
            {
                await Task.Delay(50, ct);
            }
        }
        throw new OperationCanceledException();
    }

    static async Task WaitJournalAsync(string path, string token, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            if (File.Exists(path))
            {
                var text = await File.ReadAllTextAsync(path, ct);
                if (text.Contains(token, StringComparison.Ordinal)) return;
            }
            await Task.Delay(50, ct);
        }
        throw new OperationCanceledException();
    }

    static async Task WaitUntilAsync(Func<bool> pred, CancellationToken ct, string label)
    {
        while (!ct.IsCancellationRequested)
        {
            if (pred()) return;
            await Task.Delay(50, ct);
        }
        throw new TimeoutException(label);
    }

    static void TryKill(Process? p)
    {
        try
        {
            if (p is { HasExited: false }) p.Kill(entireProcessTree: true);
        }
        catch { /* ignore */ }
    }

    static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { /* ignore */ }
    }

    sealed class Counts
    {
        public int Patches;
    }
}

/// <summary>Schema motor peer — replaces Kind FakeBrowser for Phase 10 A5.</summary>
static class SchemaFakeMotor
{
    public static async Task<int> RunAsync()
    {
        var socketPath = Environment.GetEnvironmentVariable("SPECULUM_BROWSER_SOCKET")
            ?? throw new InvalidOperationException("SPECULUM_BROWSER_SOCKET");
        var journalPath = Environment.GetEnvironmentVariable("SPECULUM_FAKE_JOURNAL")
            ?? Path.Combine(Path.GetTempPath(), "phase10-fake.log");
        var oracle = Environment.GetEnvironmentVariable("SPECULUM_CAP_EVENTS") == "1";
        await File.WriteAllTextAsync(journalPath, "");
        void J(string line) => File.AppendAllText(journalPath, line + "\n");

        using var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        var deadline = DateTime.UtcNow.AddSeconds(20);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                await socket.ConnectAsync(new UnixDomainSocketEndPoint(socketPath));
                break;
            }
            catch
            {
                await Task.Delay(50);
            }
        }
        if (!socket.Connected)
        {
            J("connect-failed");
            return 2;
        }

        await using var stream = new NetworkStream(socket, ownsSocket: false);
        var reader = new SchemaEnvelopeReader(stream);
        await using var writer = new SchemaEnvelopeWriter(stream);

        // Ready — supervisor opens ViewportOpen
        await writer.WriteAsync(OpReady.Code, 0, Codecs.EncodeReadyBytes(new Ready()), 0, CancellationToken.None);
        J("ready");
        J(oracle ? "oracle=1" : "oracle=0");

        uint viewport = 1;
        var life = new CancellationTokenSource();
        while (!life.IsCancellationRequested)
        {
            var msg = await reader.ReadAsync(life.Token);
            if (msg is null) break;
            var m = msg.Value;

            if (m.Opcode == OpViewportOpen.Code)
            {
                J("viewport-open");
                var opened = Codecs.EncodeViewportOpenedBytes(new ViewportOpened
                {
                    rootHost = viewport,
                });
                await writer.WriteAsync(OpViewportOpened.Code, viewport, opened, m.Correlation, life.Token);
                continue;
            }

            if (m.Opcode == OpNavigate.Code)
            {
                J("navigated");
                var nav = Codecs.DecodeNavigateBytes(m.Payload);
                var navigated = Codecs.EncodeNavigatedBytes(new Navigated { url = nav.url });
                await writer.WriteAsync(OpNavigated.Code, viewport, navigated, m.Correlation, life.Token);
                // One Patch so consumer counts work
                var isa = MinimalIsaFrame();
                var patch = Codecs.EncodePatchBytes(new Patch
                {
                    generation = 1,
                    sequence = 1,
                    flags = 0,
                    builtAt = 0,
                    metrics = Array.Empty<Metric>(),
                    deltas = isa,
                });
                await writer.WriteAsync(OpPatch.Code, viewport, patch, 0, life.Token);
                J("patch");
                continue;
            }

            if (m.Opcode == OpResync.Code)
            {
                J("resync");
                var isa = MinimalIsaFrame();
                var patch = Codecs.EncodePatchBytes(new Patch
                {
                    generation = 1,
                    sequence = 2,
                    flags = 0b10,
                    builtAt = 1,
                    metrics = Array.Empty<Metric>(),
                    deltas = isa,
                });
                await writer.WriteAsync(OpPatch.Code, viewport, patch, m.Correlation, life.Token);
                continue;
            }

            if (m.Opcode == OpInputPointerDown.Code || m.Opcode == OpInputPointerUp.Code ||
                m.Opcode == OpInputKeyDown.Code || m.Opcode == OpInputKeyUp.Code ||
                m.Opcode == OpInputScroll.Code)
            {
                J("input");
                continue;
            }

            if (m.Opcode == OpShutdown.Code)
            {
                J("shutdown");
                break;
            }
        }

        return 0;
    }

    static byte[] MinimalIsaFrame()
    {
        // Valid-looking ISA header magic 0x5050; body minimal — consumer treats Patch as opaque.
        var b = new byte[24];
        BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(0, 2), 0x5050);
        BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(2, 2), 1); // version
        return b;
    }
}
