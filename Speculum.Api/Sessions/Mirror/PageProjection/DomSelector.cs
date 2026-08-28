namespace Speculum.Api.Sessions.Mirror.PageProjection;

/// <summary>
/// Wire address for Dom-plane ops (<c>element</c> | <c>childAt</c>).
/// </summary>
public sealed class DomSelector
{
    /// <summary><c>element</c> or <c>childAt</c>.</summary>
    public required string Kind { get; init; }

    /// <summary>CSS query resolved with querySelectorAll; length must be 1.</summary>
    public required string Query { get; init; }

    /// <summary>F-visible child index when <see cref="Kind"/> is <c>childAt</c>.</summary>
    public int? Index { get; init; }
}
