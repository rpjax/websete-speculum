namespace Speculum.Api.Telemetry.Events.Services.Contracts;

/// <summary>Bundled Dom Projection telemetry (Diff + Input + PageEpoch parity).</summary>
public interface ISessionPageProjectionTelemetryEvents
{
    ISessionPageProjectionDiffTelemetryEvents Diff { get; }
    ISessionPageProjectionInputTelemetryEvents Input { get; }
    ISessionPageProjectionVirtualTelemetryEvents Virtual { get; }
    ISessionPageProjectionEstablishTelemetryEvents Establish { get; }
    ISessionPageProjectionAssetTelemetryEvents Asset { get; }
    ISessionPageProjectionFrameTelemetryEvents Frame { get; }
    ISessionPageProjectionPoolTelemetryEvents Pool { get; }
}
