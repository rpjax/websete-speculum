namespace Speculum.Api.Motor.Sidecar;

/// <summary>Wire <c>resizeResult</c> from the sidecar (JSON camelCase).</summary>
public sealed class SidecarResizeResult
{
    public string RequestId { get; set; } = "";
    public bool Ok { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public int? ChromeWidth { get; set; }
    public int? ChromeHeight { get; set; }
    public int? DisplayWidth { get; set; }
    public int? DisplayHeight { get; set; }
    public string? ErrorCode { get; set; }
    public string? Phase { get; set; }
    public string? Message { get; set; }
}
