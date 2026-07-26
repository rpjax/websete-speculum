namespace Speculum.Api.Configurations.Models.Sidecar;

/// <summary>gRPC transport address for the BrowserSession sidecar.</summary>
public sealed class SidecarOptions
{
    public const string SectionName = "Sidecar";

    /// <summary>
    /// gRPC base address, e.g. <c>http://sidecar:50051</c> or <c>http://127.0.0.1:50051</c>.
    /// </summary>
    public string GrpcAddress { get; set; } = "http://127.0.0.1:50051";

    /// <summary>
    /// How many times to retry a transient unary/watch reopen after the first failure
    /// (Unavailable / response ended). Session-not-found never retries.
    /// </summary>
    public int LinkRetryCount { get; set; } = 3;

    /// <summary>Fixed backoff between link retries.</summary>
    public TimeSpan LinkRetryBackoff { get; set; } = TimeSpan.FromMilliseconds(200);
}
