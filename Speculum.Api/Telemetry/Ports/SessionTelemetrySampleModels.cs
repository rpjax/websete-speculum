namespace Speculum.Api.Telemetry.Ports;

/// <summary>Telemetry-owned session sample DTOs (no Sessions domain types).</summary>
public sealed record SessionTelemetryLiveSnapshot(
    Guid SessionId,
    Guid ProfileId,
    bool JsBridgeEnabled,
    bool ConnectionOpen,
    long UptimeMs);

public sealed record SessionTelemetryLiveStatus(
    Guid SessionId,
    double Fps,
    string? Url);
