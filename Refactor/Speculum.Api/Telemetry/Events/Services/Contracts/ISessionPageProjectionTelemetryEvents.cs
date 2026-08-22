namespace Speculum.Api.Telemetry.Events.Services.Contracts;

/// <summary>Bundled Dom Projection telemetry (Frame + Input + PageEpoch parity).</summary>
public interface ISessionPageProjectionTelemetryEvents
{
    ISessionPageProjectionFrameTelemetryEvents Frame { get; }
    ISessionPageProjectionInputTelemetryEvents Input { get; }
    ISessionPageProjectionVirtualTelemetryEvents Virtual { get; }
    ISessionPageProjectionEstablishTelemetryEvents Establish { get; }
    ISessionPageProjectionAssetTelemetryEvents Asset { get; }
    ISessionPageProjectionPoolTelemetryEvents Pool { get; }
}
