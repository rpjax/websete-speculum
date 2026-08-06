namespace Speculum.Api.Telemetry.Events.Services.Contracts;

/// <summary>Bundled Dom Projection telemetry (Diff + Input) — not video-streaming input.</summary>
public interface ISessionDomProjectionTelemetryEvents
{
    ISessionDomProjectionDiffTelemetryEvents Diff { get; }
    ISessionDomProjectionInputTelemetryEvents Input { get; }
}
