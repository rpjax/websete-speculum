namespace Speculum.Api.Configurations.Models.Sidecar;

/// <summary>gRPC transport address for the BrowserSession sidecar.</summary>
public sealed class SidecarOptions
{
    public const string SectionName = "Sidecar";

    /// <summary>
    /// gRPC base address, e.g. <c>http://sidecar:50051</c> or <c>http://127.0.0.1:50051</c>.
    /// </summary>
    public string GrpcAddress { get; set; } = "http://127.0.0.1:50051";
}
