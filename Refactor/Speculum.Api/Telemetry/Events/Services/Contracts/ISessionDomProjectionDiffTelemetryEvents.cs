namespace Speculum.Api.Telemetry.Events.Services.Contracts;

/// <summary>Telemetry hops for Dom Projection DomDiff frames (sidecar → API).</summary>
public interface ISessionDomProjectionDiffTelemetryEvents
{
    void FrameReceived(
        string kind,
        string? target,
        string? treeType,
        long sequence,
        long generation,
        long timestamp,
        int? nodeCount,
        int? urlCount);

    void GenerationBumped(
        long fromGeneration,
        long toGeneration,
        string reason,
        string? url = null,
        string? diffKind = null);
}
