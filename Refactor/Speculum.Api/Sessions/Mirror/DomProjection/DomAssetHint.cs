using MessagePack;

namespace Speculum.Api.Sessions.Mirror.DomProjection;

/// <summary>Asset hint carried with a DomDiff (bytes fetched separately).</summary>
[MessagePackObject]
public sealed class DomAssetHint
{
    [Key("hash")]
    public required string Hash { get; init; }

    [Key("contentType")]
    public string ContentType { get; init; } = "application/octet-stream";
}
