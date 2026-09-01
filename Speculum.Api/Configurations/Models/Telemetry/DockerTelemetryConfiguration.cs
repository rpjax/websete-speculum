namespace Speculum.Api.Configurations.Models.Telemetry;

public sealed class DockerTelemetryConfiguration
{
    public bool IsEnabled { get; init; }

    /// <summary>Docker Engine API endpoint (e.g. <c>unix:///var/run/docker.sock</c>).</summary>
    public string Endpoint { get; init; } = "unix:///var/run/docker.sock";

    public bool IncludeRuntime { get; init; } = true;
    public bool IncludeContainers { get; init; } = true;

    /// <summary>HTTP timeout for Engine API calls (milliseconds).</summary>
    public int TimeoutMs { get; init; } = 2_000;
}
