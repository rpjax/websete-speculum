using MessagePack;

namespace Speculum.Api.Sessions.Models;

/// <summary>
/// Outcome of a resize attempt — soft rejects stay Success(IResult) with Applied=false.
/// </summary>
public enum ResizeOutcome
{
    Applied = 0,
    /// <summary>Policy or validation reject (session keeps prior geometry).</summary>
    Rejected = 1,
    /// <summary>Another command holds the session gate.</summary>
    Busy = 2,
    /// <summary>Sidecar/transport failure after validation.</summary>
    Failed = 3,
}

/// <summary>Hub return for <c>ResizeAsync</c> — confirmed geometry or explicit soft failure.</summary>
[MessagePackObject]
public sealed class ResizeResult
{
    [Key("applied")]
    public bool Applied { get; set; }

    /// <summary>Named outcome (Applied / Rejected / Busy / Failed).</summary>
    [Key("outcome")]
    public ResizeOutcome Outcome { get; set; }

    [Key("width")]
    public int Width { get; set; }

    [Key("height")]
    public int Height { get; set; }

    [Key("chromeWidth")]
    public int? ChromeWidth { get; set; }

    [Key("chromeHeight")]
    public int? ChromeHeight { get; set; }

    [Key("displayWidth")]
    public int? DisplayWidth { get; set; }

    [Key("displayHeight")]
    public int? DisplayHeight { get; set; }

    [Key("resizeId")]
    public string? ResizeId { get; set; }

    [Key("errorCode")]
    public string? ErrorCode { get; set; }

    [Key("phase")]
    public string? Phase { get; set; }

    [Key("message")]
    public string? Message { get; set; }
}
