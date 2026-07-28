namespace Speculum.Api.Configurations.Models.Telemetry;

/// <summary>
/// Sidecar section toggles — mapped 1:1 onto <c>CollectTelemetry</c> RPC request fields.
/// </summary>
public sealed class SidecarTelemetryConfiguration
{
    public bool IsEnabled { get; init; } = true;

    public bool IncludeProcess { get; init; } = true;
    public bool IncludeEventLoop { get; init; } = true;
    public bool IncludeChrome { get; init; } = true;
    public bool IncludeQueues { get; init; } = true;
    public bool IncludeSessionsSummary { get; init; } = true;
    public bool IncludeFaultedIds { get; init; } = true;

    /// <summary>Unary RPC timeout (milliseconds).</summary>
    public int TimeoutMs { get; init; } = 2_000;
}
