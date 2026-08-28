namespace Speculum.Api.Configurations.Models.Diagnostics;

public sealed class DiagnosticsConfiguration
{
    public const string SectionName = "Diagnostics";

    public bool IsEnabled { get; init; } = true;

    public IReadOnlyDictionary<DiagnosticsDomain, DiagnosticsCapabilityToggles> Domains { get; init; }
        = new Dictionary<DiagnosticsDomain, DiagnosticsCapabilityToggles>
        {
            [DiagnosticsDomain.Sessions] = new()
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
        };

    public DiagnosticsSamplingConfiguration Sampling { get; init; } = new();
}
