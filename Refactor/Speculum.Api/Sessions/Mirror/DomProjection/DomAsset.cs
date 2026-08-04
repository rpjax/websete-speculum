namespace Speculum.Api.Sessions.Mirror.DomProjection;

/// <summary>Fetched Dom Projection asset bytes (css/img/font) keyed by hash.</summary>
public sealed class DomAsset
{
    public required byte[] Body { get; init; }

    public string ContentType { get; init; } = "application/octet-stream";
}
