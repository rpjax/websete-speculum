using System.Diagnostics;
using System.Globalization;

namespace Speculum.Tests;

/// <summary>
/// Fala com o CLI L0 do Producer. O C# não spawna tsx.
/// </summary>
public sealed class ProducerCli : IDisposable
{
    private readonly Process _process;
    private readonly StreamWriter _stdin;
    private readonly object _gate = new();

    private ProducerCli(Process process, StreamWriter stdin)
    {
        _process = process;
        _stdin = stdin;
    }

    public static bool TryStart(out ProducerCli? cli, out string problem)
    {
        var path = Environment.GetEnvironmentVariable("SPECULUM_PRODUCER_CLI");
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            cli = null;
            problem = path is null ? "SPECULUM_PRODUCER_CLI não definida" : $"não existe: {path}";
            return false;
        }

        var info = new ProcessStartInfo(path)
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        var process = new Process { StartInfo = info };
        process.Start();
        cli = new ProducerCli(process, process.StandardInput);
        problem = "";
        return true;
    }

    public byte[]? Boot() => SendExpectFrame("boot");

    public void Line(string command)
    {
        lock (_gate)
        {
            _stdin.WriteLine(command);
            _stdin.Flush();
            var reply = _process.StandardOutput.ReadLine() ?? "";
            if (reply != "OK" && reply != "EMPTY" && !reply.StartsWith("FRAME ", StringComparison.Ordinal)
                && !reply.StartsWith("SNAP ", StringComparison.Ordinal))
            {
                throw new InvalidDataException($"CLI: {command} -> {reply}");
            }
        }
    }

    public byte[]? Flush() => SendExpectFrame("flush");

    public byte[]? Tick() => SendExpectFrame("tick");

    public byte[] Snapshot()
    {
        lock (_gate)
        {
            _stdin.WriteLine("snapshot");
            _stdin.Flush();
            var reply = _process.StandardOutput.ReadLine() ?? "";
            return Parse(reply, "SNAP");
        }
    }

    public byte[]? Resync() => SendExpectFrame("resync");

    public void Halt() => Line("halt");

    public void Resume() => Line("resume");

    public void Dispose()
    {
        try
        {
            _stdin.Dispose();
            if (!_process.HasExited)
            {
                _process.Kill(entireProcessTree: true);
                _process.WaitForExit(2000);
            }
        }
        catch (InvalidOperationException)
        {
            // já saiu
        }
        finally
        {
            _process.Dispose();
        }
    }

    private byte[]? SendExpectFrame(string command)
    {
        lock (_gate)
        {
            _stdin.WriteLine(command);
            _stdin.Flush();
            var reply = _process.StandardOutput.ReadLine() ?? "";
            if (reply == "EMPTY")
            {
                return null;
            }

            return Parse(reply, "FRAME");
        }
    }

    public static byte[] Parse(string line, string prefix)
    {
        if (!line.StartsWith(prefix + " ", StringComparison.Ordinal))
        {
            throw new InvalidDataException($"esperado {prefix}, veio: {line}");
        }

        return ParseHex(line[(prefix.Length + 1)..]);
    }

    public static byte[] ParseHex(string text)
    {
        var compact = text.Where(c => !char.IsWhiteSpace(c)).ToArray();
        if (compact.Length % 2 != 0)
        {
            throw new InvalidDataException("hex ímpar");
        }

        var bytes = new byte[compact.Length / 2];
        for (var i = 0; i < bytes.Length; i++)
        {
            bytes[i] = byte.Parse(compact.AsSpan(i * 2, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        }

        return bytes;
    }
}
