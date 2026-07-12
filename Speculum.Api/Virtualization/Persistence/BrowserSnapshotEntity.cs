using System.Text.Json.Serialization;

namespace Speculum.Api.Virtualization.Persistence;

public sealed class BrowserSnapshotEntity
{
    public string SessionId { get; set; } = "";
    public byte[] ProfileBlob { get; set; } = [];
    public string LastUrl { get; set; } = "";
    public int ByteSize { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}

public sealed class BrowserSnapshotMetadata
{
    [JsonPropertyName("sessionId")]
    public required string SessionId { get; init; }

    public required string LastUrl { get; init; }
    public int ByteSize { get; init; }
    public DateTimeOffset UpdatedAt { get; init; }
    public DateTimeOffset ExpiresAt { get; init; }
}

public sealed class BrowserSnapshotRecord
{
    public required string SessionId { get; init; }
    public byte[] ProfileBlob { get; init; } = [];
    public required string LastUrl { get; init; }
    public DateTimeOffset UpdatedAt { get; init; }
}
