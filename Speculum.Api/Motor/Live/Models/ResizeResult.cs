using MessagePack;

namespace Speculum.Api.Motor.Live.Models;

/// <summary>Hub return for <c>ResizeAsync</c> — confirmed geometry or explicit failure.</summary>
[MessagePackObject]
public sealed class ResizeResult
{
    [Key("applied")]
    public bool Applied { get; set; }

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
