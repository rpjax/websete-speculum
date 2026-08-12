namespace Speculum.Api.Sessions.Mirror.PageProjection;

/// <summary>Fetched Dom Projection virtual resource bytes.</summary>
public sealed class DomAsset
{
    public required byte[] Body { get; init; }

    public string ContentType { get; init; } = "application/octet-stream";

    public int StatusCode { get; init; } = 200;

    public string? ContentRange { get; init; }

    public bool PassThrough { get; init; }

    /// <summary>§5.12.2.1 shareability input — the origin request carried a <c>Cookie</c> header.</summary>
    public bool RequestHadCookie { get; init; }

    /// <summary>§5.12.2.1 — the origin request carried an <c>Authorization</c> header.</summary>
    public bool RequestHadAuthorization { get; init; }

    /// <summary>Raw <c>Cache-Control</c> response header value (comma-joined directives), or null when absent.</summary>
    public string? CacheControl { get; init; }

    /// <summary>Raw <c>Vary</c> response header value (comma-joined values), or null when absent.</summary>
    public string? Vary { get; init; }
}
