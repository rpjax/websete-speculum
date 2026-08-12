namespace Speculum.Api.Sessions.Mirror.PageProjection;

/// <summary>
/// OOB PageProjection.Resync body (§5.7.2) — does not advance live sequence.
/// <see cref="FrameParts"/> are opaque §5.5 binary wire parts with the resync flag set.
/// </summary>
public sealed class PageProjectionResyncSnapshot
{
    public long Generation { get; init; }

    public long CoversThroughSequence { get; init; }

    /// <summary>Opaque §5.5 binary frame parts (resync flag). Never parsed by the API.</summary>
    public required IReadOnlyList<byte[]> FrameParts { get; init; }

    public string? PageEpochId { get; init; }

    public string? Source { get; init; }

    public long DomMapMs { get; init; }

    public long CssomCloneMs { get; init; }

    public long RewriteMs { get; init; }

    public long SerializeMs { get; init; }
}
