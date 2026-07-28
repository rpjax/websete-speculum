namespace Speculum.Api.Configurations.Models.Telemetry;

/// <summary>
/// Periodic composite sample settings plus opt-in Telemetry event fact toggles.
/// Applied as engine section <see cref="SectionName"/>.
/// Independent of Diagnostics — sink is Journal.
/// </summary>
public sealed class TelemetryConfiguration
{
    public const string SectionName = "Telemetry";
    public const int MinIntervalSeconds = 1;
    public const int MaxIntervalSeconds = 3_600;

    /// <summary>Master switch for the sampler hosted service (no compose work when false).</summary>
    public bool IsEnabled { get; init; }

    /// <summary>Sample cadence in seconds.</summary>
    public int IntervalSeconds { get; init; } = 30;

    public HostTelemetryConfiguration Host { get; init; } = new();
    public ApiProcessTelemetryConfiguration ApiProcess { get; init; } = new();
    public SessionTelemetryConfiguration Sessions { get; init; } = new();
    public SidecarTelemetryConfiguration Sidecar { get; init; } = new();
    public ProfileTelemetryConfiguration Profiles { get; init; } = new();
    public JournalTelemetryConfiguration Journal { get; init; } = new();
    public DockerTelemetryConfiguration Docker { get; init; } = new();

    /// <summary>
    /// Opt-in Telemetry event facts (not sampling). Key = catalog type
    /// (e.g. <c>Telemetry.Sessions.Input.WebTransportReceived</c>). Omitted = off.
    /// </summary>
    public Dictionary<string, bool> Events { get; init; } = new(StringComparer.Ordinal);

    public static int ClampIntervalSeconds(int intervalSeconds)
        => Math.Clamp(intervalSeconds, MinIntervalSeconds, MaxIntervalSeconds);
}
