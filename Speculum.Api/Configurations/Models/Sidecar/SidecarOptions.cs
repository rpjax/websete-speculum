namespace Speculum.Api.Configurations.Models.Sidecar;

/// <summary>Transport to the browser host: Gecko orchestrator (product) or Chromium gRPC (SessionsTest CI).</summary>
public sealed class SidecarOptions
{
    public const string SectionName = "Sidecar";

    /// <summary>
    /// Default send/receive ceiling for the BrowserSession gRPC channel (64 MiB).
    /// Covers OOB PageProjection.Resync snapshots for large SPAs (Beleza-scale).
    /// Chromium engine only.
    /// </summary>
    public const int DefaultMaxGrpcMessageBytes = 64 * 1024 * 1024;

    /// <summary>Inclusive lower bound for <see cref="MaxGrpcMessageBytes"/>.</summary>
    public const int MinMaxGrpcMessageBytes = 1 * 1024 * 1024;

    /// <summary>Inclusive upper bound for <see cref="MaxGrpcMessageBytes"/>.</summary>
    public const int AbsoluteMaxGrpcMessageBytes = 256 * 1024 * 1024;

    /// <summary>Product default is Gecko. SessionsTest CI sets Chromium.</summary>
    public SidecarEngine Engine { get; set; } = SidecarEngine.Gecko;

    /// <summary>Gecko orchestrator base, e.g. <c>http://sidecar:4100</c>. Required when <see cref="Engine"/> is Gecko.</summary>
    public string OrchestratorAddress { get; set; } = "http://127.0.0.1:4100";

    /// <summary>
    /// Chromium gRPC base address, e.g. <c>http://sidecar:50051</c>.
    /// Required when <see cref="Engine"/> is Chromium. Not an alias of <see cref="OrchestratorAddress"/>.
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
