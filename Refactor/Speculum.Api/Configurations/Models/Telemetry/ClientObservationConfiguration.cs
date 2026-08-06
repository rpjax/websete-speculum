namespace Speculum.Api.Configurations.Models.Telemetry;

/// <summary>
/// Opt-in browser-side observation ring (Lab + Live). Projected to public client-config.
/// Capability toggles per plane — not log levels. Independent of Journal event facts;
/// operators pair this with <see cref="TelemetryConfiguration.Events"/> for correlation.
/// </summary>
public sealed class ClientObservationConfiguration
{
    /// <summary>Master: front debug ring + Live/Lab observation chrome.</summary>
    public bool IsEnabled { get; init; }

    /// <summary>Session hub/wire lifecycle entries (connect, start, syncUrl, …).</summary>
    public bool SessionWire { get; init; } = true;

    /// <summary>VideoStreamingInput client hops (<c>sendInput</c> → correlation with Journal).</summary>
    public bool VideoStreamingInput { get; init; }

    /// <summary>DomProjection Diff recv/apply hops (generation, sequence, gaps).</summary>
    public bool DomProjectionDiff { get; init; }

    /// <summary>DomProjection Input client hops (<c>sendDomInput</c> / capture).</summary>
    public bool DomProjectionInput { get; init; }
}
