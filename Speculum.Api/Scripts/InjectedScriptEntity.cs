namespace Speculum.Api.Scripts;

public sealed class InjectedScriptEntity
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Content { get; set; } = "";
    public string Sha256 { get; set; } = "";
    public int Size { get; set; }
    public DateTimeOffset UploadedAt { get; set; }
}

public sealed class InjectedScriptMetadata
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Sha256 { get; init; }
    public int Size { get; init; }
    public DateTimeOffset UploadedAt { get; init; }
}
