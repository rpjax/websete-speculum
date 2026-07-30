namespace Speculum.Api.Scripts.Responses;

public sealed class ScriptListItem
{
    public Guid Id { get; init; }

    public string Name { get; init; } = "";

    public string Sha256 { get; init; } = "";

    public int Size { get; init; }

    public DateTimeOffset UploadedAt { get; init; }

    public DateTimeOffset UpdatedAt { get; init; }
}
