namespace Speculum.Api.BrowserSessions.Models;

/// <summary>
/// Resolved script content for sidecar injection at launch.
/// The connection does not load files or HTTP — callers resolve content first.
/// </summary>
public sealed class ScriptInjection
{
    public required string Position { get; init; }

    public required string Type { get; init; }

    public required string File { get; init; }

    public required string Content { get; init; }
}
