namespace Speculum.Api.Configurations.Models.Telemetry;

/// <summary>Journal drain pressure (replaces the old Diagnostics <c>pipeline</c> section).</summary>
public sealed class JournalTelemetryConfiguration
{
    public bool IsEnabled { get; init; } = true;
    public bool IncludePressure { get; init; } = true;
}
