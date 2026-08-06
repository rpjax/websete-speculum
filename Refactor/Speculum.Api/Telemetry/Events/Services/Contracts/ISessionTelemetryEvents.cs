namespace Speculum.Api.Telemetry.Events.Services.Contracts;

/// <summary>
/// Bundled session-scoped telemetry emitters (not a god interface — each capability is a sub-contract).
/// </summary>
public interface ISessionTelemetryEvents
{
    ISessionCapacityTelemetryEvents Capacity { get; }
    ISessionStartTelemetryEvents Start { get; }
    ISessionNavigateTelemetryEvents Navigate { get; }
    ISessionPersistTelemetryEvents Persist { get; }
    /// <summary>VideoStreamingInput plane (screencast mirror). Not Dom Projection.</summary>
    ISessionVideoStreamingInputTelemetryEvents VideoStreamingInput { get; }
    ISessionDomProjectionTelemetryEvents DomProjection { get; }
    ISessionResizeTelemetryEvents Resize { get; }
    ISessionBrowseTelemetryEvents Browse { get; }
    ISessionClientTelemetryEvents Client { get; }
    ISessionSidecarTelemetryEvents Sidecar { get; }
}
