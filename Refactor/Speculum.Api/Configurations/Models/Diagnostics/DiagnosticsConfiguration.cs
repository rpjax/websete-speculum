namespace Speculum.Api.Configurations.Models.Diagnostics;

public sealed class DiagnosticsConfiguration
{
    public bool IsEnabled { get; init; } = true;

    public IReadOnlyDictionary<DiagnosticsDomain, DiagnosticsCapabilityToggles> Domains { get; init; }
        = new Dictionary<DiagnosticsDomain, DiagnosticsCapabilityToggles>
        {
            [DiagnosticsDomain.Motor] = new()
            {
                Metrics = true,
                Events = true,
                Snapshots = true,
            },
            [DiagnosticsDomain.Sidecar] = new()
            {
                Metrics = true,
                Events = true,
            },
            [DiagnosticsDomain.BrowserQuery] = new(),
            [DiagnosticsDomain.Profiles] = new()
            {
                Snapshots = true,
            },
            [DiagnosticsDomain.Telemetry] = new()
            {
                Metrics = true,
            },
        };

    public TelemetryConfiguration Telemetry { get; init; } = new();
    public DiagnosticsSamplingConfiguration Sampling { get; init; } = new();
}
