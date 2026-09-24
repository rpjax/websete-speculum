using Speculum.Supervisor.Wire;
using Speculum.Wire;

namespace Speculum.Supervisor.Control;

/// <summary>
/// Builds full schema envelopes (header+payload) for Lab/Orchestrator callers.
/// Generated codec only — no ControlAbi.
/// </summary>
public static class SchemaCommands
{
    public static byte[] ViewportOpen(uint correlation, uint target, int width, int height)
    {
        var payload = Codecs.EncodeViewportOpenBytes(new ViewportOpen
        {
            extent = new Extent { width = width, height = height },
        });
        return SchemaEnvelope.Pack(OpViewportOpen.Code, target, payload, correlation);
    }

    public static byte[] Navigate(uint correlation, uint target, string url)
    {
        var payload = Codecs.EncodeNavigateBytes(new Navigate { url = url });
        return SchemaEnvelope.Pack(OpNavigate.Code, target, payload, correlation);
    }

    public static byte[] Resync(uint correlation, uint target, ResyncForce force)
    {
        var payload = Codecs.EncodeResyncBytes(new Resync { force = force, scope = Scope.Self });
        return SchemaEnvelope.Pack(OpResync.Code, target, payload, correlation);
    }

    public static byte[] Resync(uint correlation, uint target, byte forceByte)
        => Resync(correlation, target, forceByte == 0 ? ResyncForce.FromMap : ResyncForce.FromWalk);

    public static byte[] ViewportResize(uint correlation, uint target, int width, int height)
    {
        var payload = Codecs.EncodeViewportResizeBytes(new ViewportResize
        {
            extent = new Extent { width = width, height = height },
        });
        return SchemaEnvelope.Pack(OpViewportResize.Code, target, payload, correlation);
    }

    public static byte[] ClocksHalt(uint correlation)
    {
        var payload = Codecs.EncodeClocksHaltBytes(new ClocksHalt { scope = Scope.Subtree });
        return SchemaEnvelope.Pack(OpClocksHalt.Code, 0, payload, correlation);
    }

    public static byte[] ClocksResume(uint correlation)
    {
        var payload = Codecs.EncodeClocksResumeBytes(new ClocksResume { scope = Scope.Subtree });
        return SchemaEnvelope.Pack(OpClocksResume.Code, 0, payload, correlation);
    }

    public static byte[] Flush(uint correlation, uint target, uint generation)
    {
        var payload = Codecs.EncodeFlushBytes(new Flush { generation = generation });
        return SchemaEnvelope.Pack(OpFlush.Code, target, payload, correlation);
    }

    public static byte[] Snapshot(uint correlation, uint target, uint generation)
    {
        var payload = Codecs.EncodeSnapshotBytes(new Snapshot { generation = generation });
        return SchemaEnvelope.Pack(OpSnapshot.Code, target, payload, correlation);
    }

    public static byte[] Shutdown(uint correlation)
    {
        var payload = Codecs.EncodeShutdownBytes(new Shutdown());
        return SchemaEnvelope.Pack(OpShutdown.Code, 0, payload, correlation);
    }

    public static byte[] Reload(uint correlation, uint target)
    {
        var payload = Codecs.EncodeReloadBytes(new Reload());
        return SchemaEnvelope.Pack(OpReload.Code, target, payload, correlation);
    }

    public static byte[] StopLoad(uint correlation, uint target)
    {
        var payload = Codecs.EncodeStopLoadBytes(new StopLoad());
        return SchemaEnvelope.Pack(OpStopLoad.Code, target, payload, correlation);
    }

    public static byte[] HistoryGo(uint correlation, uint target, int delta)
    {
        var payload = Codecs.EncodeHistoryGoBytes(new HistoryGo { delta = delta });
        return SchemaEnvelope.Pack(OpHistoryGo.Code, target, payload, correlation);
    }
}
