namespace Speculum.Api.Config.Runtime;

/// <summary>
/// Reference-only script injection entry persisted in the database.
/// Exactly one of <see cref="ScriptId"/> or <see cref="Url"/> must be set.
/// </summary>
public sealed class ScriptInjectionEntry
{
    public string? ScriptId { get; init; }
    public string? Url { get; init; }
    public string Position { get; init; } = "HeaderTop";
    public string Type { get; init; } = "Classic";
}
