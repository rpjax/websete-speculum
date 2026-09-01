using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Requests;

/// <summary>Runtime viewport resize against a live session.</summary>
public sealed class ResizeSession
{
    public Guid SessionId { get; set; }

    /// <summary>
    /// Correlation id for the resize round-trip. When empty, the service mints one.
    /// </summary>
    public string RequestId { get; set; } = string.Empty;

    public int Width { get; set; }

    public int Height { get; set; }

    /// <summary>Optional device emulation applied with the resize.</summary>
    public DeviceProfile? Device { get; set; }
}
