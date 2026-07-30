namespace Speculum.Api.Scripts.Responses;

public sealed class ScriptPage
{
    public required IReadOnlyList<ScriptListItem> Items { get; init; }

    public int Total { get; init; }
}
