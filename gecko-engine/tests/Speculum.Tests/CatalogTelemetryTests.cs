using Speculum.Supervisor.Control;
using Speculum.Supervisor.Wire;

namespace Speculum.Tests;

/// <summary>Decode Virtual (Kind 0x05 + Snapshot/Fault) — biblioteca do consumidor.</summary>
public static class CatalogTelemetryTests
{
    public static int Run(Report report)
    {
        Console.WriteLine("CatalogTelemetry + Snapshot/Fault decode");

        FrameEmitted(report);
        ResyncRequested(report);
        ProducerFault(report);
        InputRejected(report);
        SnapshotRoundtrip(report);
        FaultSplit(report);
        CapsEnv(report);

        return 0;
    }

    private static void FrameEmitted(Report report)
    {
        var body = new byte[37];
        WriteU32(body, 0, 7);   // seq
        WriteU32(body, 4, 2);   // gen
        WriteU32(body, 8, 100); // bytes
        WriteU32(body, 12, 3);  // ops
        WriteU32(body, 16, 50); // table
        WriteU32(body, 20, 40); // identity
        WriteU32(body, 24, 12); // buildMs
        WriteU32(body, 28, 4);  // encodeMs
        WriteU32(body, 32, 1);  // dropped
        body[36] = 1;           // resync

        var payload = Prefixed((ushort)CatalogTelemetry.Catalog.FrameEmitted, body);
        var msg = CatalogTelemetry.TryDecode(1, payload) as CatalogTelemetry.FrameEmittedMessage;
        report.equal("frameEmitted decode", true, msg is not null);
        report.equal("frameEmitted.seq", 7u, msg!.Sequence);
        report.equal("frameEmitted.buildMs", 12u, msg.BuildMs);
        report.equal("frameEmitted.resync", true, msg.Resync);
    }

    private static void ResyncRequested(Report report)
    {
        var payload = Prefixed((ushort)CatalogTelemetry.Catalog.ResyncRequested, [1]);
        var msg = CatalogTelemetry.TryDecode(3, payload) as CatalogTelemetry.ResyncRequestedMessage;
        report.equal("resyncRequested", true, msg is not null);
        report.equal("resyncRequested.force", (byte)1, msg!.Force);
    }

    private static void ProducerFault(Report report)
    {
        var code = "bridge_down"u8.ToArray();
        var phase = "emit"u8.ToArray();
        var body = new byte[8 + code.Length + phase.Length];
        WriteU32(body, 0, (uint)code.Length);
        Buffer.BlockCopy(code, 0, body, 4, code.Length);
        WriteU32(body, 4 + code.Length, (uint)phase.Length);
        Buffer.BlockCopy(phase, 0, body, 8 + code.Length, phase.Length);

        var payload = Prefixed((ushort)CatalogTelemetry.Catalog.ProducerFault, body);
        var msg = CatalogTelemetry.TryDecode(1, payload) as CatalogTelemetry.ProducerFaultMessage;
        report.equal("producerFault", true, msg is not null);
        report.equal("producerFault.code", "bridge_down", msg!.ErrorCode);
        report.equal("producerFault.phase", "emit", msg.Phase);
    }

    private static void InputRejected(Report report)
    {
        var payload = Prefixed((ushort)CatalogTelemetry.Catalog.InputRejected, [3]);
        var msg = CatalogTelemetry.TryDecode(1, payload) as CatalogTelemetry.InputMessage;
        report.equal("inputRejected", true, msg is not null);
        report.equal("inputRejected.kind", "inputRejected", msg!.Kind);
    }

    private static void SnapshotRoundtrip(Report report)
    {
        var dump = "DUMP"u8.ToArray();
        var served = ControlCommand.SnapshotServed(9, 1, 0, 1, 0xabc, dump);
        var snap = SnapshotServedPayload.Decode(served);
        report.equal("snapshot.corr", 9u, snap.CorrelationId);
        report.equal("snapshot.seq", 1u, snap.Sequence);
        report.equal("snapshot.hash", 0xabcul, snap.TableHash);
        report.Bytes("snapshot.dump", dump, snap.Dump);
    }

    private static void FaultSplit(Report report)
    {
        var fault = ControlCommandFault(0, 1, "response_too_large|snapshot");
        var decoded = FaultPayload.Decode(fault);
        report.equal("fault.code", "response_too_large", decoded.ErrorCode);
        report.equal("fault.phase", "snapshot", decoded.Phase);
    }

    private static void CapsEnv(Report report)
    {
        Environment.SetEnvironmentVariable("SPECULUM_BROWSER_BIN", "/tmp/fake-firefox");
        Environment.SetEnvironmentVariable("SPECULUM_CAP_EVENTS", "1");
        Environment.SetEnvironmentVariable("SPECULUM_CAP_METRICS", "0");
        try
        {
            var opts = Speculum.Supervisor.SupervisorOptions.FromEnvironment();
            report.equal("opts.capEvents", true, opts.CapEvents);
            report.equal("opts.capMetrics", false, opts.CapMetrics);
        }
        finally
        {
            Environment.SetEnvironmentVariable("SPECULUM_CAP_EVENTS", null);
            Environment.SetEnvironmentVariable("SPECULUM_CAP_METRICS", null);
            Environment.SetEnvironmentVariable("SPECULUM_BROWSER_BIN", null);
        }

        Environment.SetEnvironmentVariable("SPECULUM_BROWSER_BIN", "/tmp/fake-firefox");
        try
        {
            var quiet = Speculum.Supervisor.SupervisorOptions.FromEnvironment();
            report.equal("opts.defaultEventsOff", false, quiet.CapEvents);
            report.equal("opts.defaultMetricsOff", false, quiet.CapMetrics);
        }
        finally
        {
            Environment.SetEnvironmentVariable("SPECULUM_BROWSER_BIN", null);
        }
    }

    private static byte[] Prefixed(ushort catalog, byte[] body)
    {
        var payload = new byte[2 + body.Length];
        BitConverter.TryWriteBytes(payload.AsSpan(0, 2), catalog);
        Buffer.BlockCopy(body, 0, payload, 2, body.Length);
        return payload;
    }

    private static void WriteU32(byte[] buf, int offset, uint value) =>
        BitConverter.TryWriteBytes(buf.AsSpan(offset, 4), value);

    private static byte[] ControlCommandFault(uint corr, uint ctx, string reason)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint) + ControlWriter.SizeOfString(reason)];
        var writer = new ControlWriter(buffer, ControlOpCode.Fault, corr);
        writer.WriteUInt32(ctx);
        writer.WriteString(reason);
        return buffer;
    }
}
