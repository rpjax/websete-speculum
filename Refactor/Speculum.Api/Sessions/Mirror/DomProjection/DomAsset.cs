namespace Speculum.Api.Sessions.Mirror.DomProjection;

/// <summary>Fetched Dom Projection virtual resource bytes.</summary>
public sealed class DomAsset
{
    public required byte[] Body { get; init; }

    public string ContentType { get; init; } = "application/octet-stream";

    public int StatusCode { get; init; } = 200;

    public string? ContentRange { get; init; }

    public bool PassThrough { get; init; }
}
