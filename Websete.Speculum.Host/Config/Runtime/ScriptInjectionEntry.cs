namespace Websete.Speculum.Host.Config.Runtime;

/// <summary>
/// Reference-only script injection entry persisted in the database.
/// Exactly one of <see cref="File"/> or <see cref="Source"/> must be set.
/// </summary>
public sealed class ScriptInjectionEntry
{
    public string? File { get; init; }
    public string? Source { get; init; }
    public string Position { get; init; } = "HeaderTop";
    public string Type { get; init; } = "Classic";
}
