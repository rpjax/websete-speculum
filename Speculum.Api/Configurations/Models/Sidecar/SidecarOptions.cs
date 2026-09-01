namespace Speculum.Api.Configurations.Models.Sidecar;

/// <summary>gRPC transport address for the BrowserSession sidecar.</summary>
public sealed class SidecarOptions
{
    public const string SectionName = "Sidecar";

    /// <summary>
    /// Default send/receive ceiling for the BrowserSession gRPC channel (64 MiB).
    /// Covers OOB PageProjection.Resync snapshots for large SPAs (Beleza-scale).
    /// </summary>
    public const int DefaultMaxGrpcMessageBytes = 64 * 1024 * 1024;

    /// <summary>Inclusive lower bound for <see cref="MaxGrpcMessageBytes"/>.</summary>
    public const int MinMaxGrpcMessageBytes = 1 * 1024 * 1024;

    /// <summary>Inclusive upper bound for <see cref="MaxGrpcMessageBytes"/>.</summary>
    public const int AbsoluteMaxGrpcMessageBytes = 256 * 1024 * 1024;

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

    /// <summary>
    /// Max gRPC message size (bytes) for both send and receive on the BrowserSession
    /// channel — OOB resync snapshots, Dom assets, and other large unaries.
    /// </summary>
    public int MaxGrpcMessageBytes { get; set; } = DefaultMaxGrpcMessageBytes;
}
