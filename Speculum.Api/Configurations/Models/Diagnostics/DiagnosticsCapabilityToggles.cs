namespace Speculum.Api.Configurations.Models.Diagnostics;

public sealed class DiagnosticsCapabilityToggles
{
    public bool Metrics { get; init; }
    public bool Events { get; init; }
    public bool Snapshots { get; init; }
    public bool Probes { get; init; }
}
