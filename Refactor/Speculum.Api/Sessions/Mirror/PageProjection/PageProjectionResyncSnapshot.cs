namespace Speculum.Api.Sessions.Mirror.PageProjection;

/// <summary>OOB PageProjection.Resync body (T8/C8) — does not advance live sequence.</summary>
public sealed class PageProjectionResyncSnapshot
{
    public long Generation { get; init; }

    public long CoversThroughSequence { get; init; }

    /// <summary>UTF-8 JSON of Dom <c>document.root</c> (F html).</summary>
    public required byte[] RootJson { get; init; }

    /// <summary>UTF-8 JSON array of Cssom sheets (install payload).</summary>
    public required byte[] SheetsJson { get; init; }
}
