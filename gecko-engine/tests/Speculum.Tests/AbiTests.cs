using Speculum.Supervisor.Control;
using Speculum.Supervisor.Wire;

namespace Speculum.Tests;

/// <summary>
/// L1 — o contrato binário (doc 19 §3).
///
/// Cada vetor de ouro é provado nas duas direções: codificar tem que produzir
/// exatamente aqueles bytes, e decodificar aqueles bytes tem que produzir
/// exatamente aqueles campos. Divergir aqui é defeito de contrato.
/// </summary>
public static class AbiTests
{
    public static int Run(string goldenPath)
    {
        var report = new Report("L1 ABI");
        Console.WriteLine("L1 — ABI de controle (vetores de ouro)");

        if (!File.Exists(goldenPath))
        {
            report.Fail("vetores de ouro", goldenPath, "arquivo não encontrado");
            return report.Finish();
        }

        var vectors = Load(goldenPath);
        report.Equal("vetores carregados", 12, vectors.Count);

        // ---- codificação: os comandos que o supervisor emite ----
        Check(report, vectors, "ContextCreate", ControlCommand.ContextCreate(1, 1, 1280, 800));
        Check(report, vectors, "ContextDestroy", ControlCommand.ContextDestroy(7, 1));
        Check(report, vectors, "Navigate", ControlCommand.Navigate(2, 1, "https://example.com"));
        Check(report, vectors, "Navigate-utf8", ControlCommand.Navigate(3, 1, "https://pt.wikipedia.org/wiki/Ação"));
        Check(report, vectors, "Shutdown", ControlCommand.Shutdown(9));
        Check(report, vectors, "Resync", ControlCommand.Resync(4, 1, 0));

        // ---- decodificação: os eventos que o browser emite ----
        Decode(report, vectors, "Ready", e =>
        {
            report.Equal("Ready.opcode", ControlOpCode.Ready, e.OpCode);
            report.Equal("Ready.correlationId", 0u, e.CorrelationId);
        });

        Decode(report, vectors, "Heartbeat", e =>
        {
            report.Equal("Heartbeat.opcode", ControlOpCode.Heartbeat, e.OpCode);
            report.Equal("Heartbeat.monotonicMs", 1234567890123UL, e.BrowsingContextId);
        });

        Decode(report, vectors, "ContextCreated", e =>
        {
            report.Equal("ContextCreated.contextId", 1u, e.ContextId);
            report.Equal("ContextCreated.browsingContextId", 42UL, e.BrowsingContextId);
            report.Equal("ContextCreated.parentContextId", 0u, e.ParentContextId);
        });

        Decode(report, vectors, "ContextDestroyed", e =>
            report.Equal("ContextDestroyed.contextId", 1u, e.ContextId));

        Decode(report, vectors, "Navigated", e =>
        {
            report.Equal("Navigated.contextId", 1u, e.ContextId);
            report.Equal("Navigated.url", "https://example.com/", e.Text);
        });

        Decode(report, vectors, "Fault", e =>
        {
            report.Equal("Fault.contextId", 0u, e.ContextId);
            report.Equal("Fault.reason", "contexto desconhecido", e.Text);
        });

        // ---- envelope ----
        EnvelopeRoundTrip(report, vectors);

        // ---- bordas que já nos morderam ----
        Truncated(report);
        UnknownOpCode(report);

        return report.Finish();
    }

    private static void Check(Report report, Dictionary<string, Vector> vectors, string name, byte[] produced)
    {
        if (!vectors.TryGetValue(name, out var vector))
        {
            report.Fail($"vetor {name}", "presente no arquivo", "ausente");
            return;
        }

        report.Bytes($"codifica {name}", vector.Payload, produced);
    }

    private static void Decode(Report report, Dictionary<string, Vector> vectors, string name, Action<BrowserEvent> assert)
    {
        if (!vectors.TryGetValue(name, out var vector))
        {
            report.Fail($"vetor {name}", "presente no arquivo", "ausente");
            return;
        }

        try
        {
            assert(BrowserEvent.Decode(vector.Payload));
        }
        catch (Exception ex)
        {
            report.Fail($"decodifica {name}", "sucesso", ex.Message, Report.Hex(vector.Payload));
        }
    }

    private static void EnvelopeRoundTrip(Report report, Dictionary<string, Vector> vectors)
    {
        var vector = vectors["ContextCreate"];
        var header = new byte[Envelope.HeaderBytes];
        Envelope.WriteHeader(header, EnvelopeKind.Control, 1, vector.Payload.Length);

        var expectedHeader = vector.Envelope[..Envelope.HeaderBytes];
        report.Bytes("envelope do ContextCreate", expectedHeader, header);

        var (kind, contextId, length) = Envelope.ReadHeader(vector.Envelope);
        report.Equal("envelope.kind", EnvelopeKind.Control, kind);
        report.Equal("envelope.contextId", 1u, contextId);
        report.Equal("envelope.length", vector.Payload.Length, length);
    }

    private static void Truncated(Report report)
    {
        // O cabeçalho de controle tem 6 bytes. Cinco tem que falhar, e falhar
        // dizendo que faltou — nunca ler fora do limite.
        var short5 = new byte[] { 0x01, 0x01, 0x01, 0x00, 0x00 };
        try
        {
            _ = new ControlReader(short5);
            report.Fail("mensagem truncada recusada", "InvalidDataException", "aceitou 5 bytes");
        }
        catch (InvalidDataException)
        {
            report.Pass("mensagem truncada recusada (5 bytes < cabeçalho de 6)");
        }
    }

    private static void UnknownOpCode(Report report)
    {
        // Doc 18 §4: desconhecido nunca derruba a ponte.
        var payload = new byte[] { 0xff, 0x7f, 0x2a, 0x00, 0x00, 0x00 };
        try
        {
            var e = BrowserEvent.Decode(payload);
            report.Equal("opcode desconhecido preserva correlationId", 42u, e.CorrelationId);
        }
        catch (Exception ex)
        {
            report.Fail("opcode desconhecido tolerado", "decodifica sem lançar", ex.GetType().Name);
        }
    }

    private readonly record struct Vector(byte[] Payload, byte[] Envelope);

    private static Dictionary<string, Vector> Load(string path)
    {
        var vectors = new Dictionary<string, Vector>(StringComparer.Ordinal);
        foreach (var raw in File.ReadAllLines(path))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#'))
            {
                continue;
            }

            var parts = line.Split('|');
            if (parts.Length != 3)
            {
                continue;
            }

            vectors[parts[0].Trim()] = new Vector(
                Report.ParseHex(parts[1].Trim()),
                Report.ParseHex(parts[2].Trim()));
        }

        return vectors;
    }
}
