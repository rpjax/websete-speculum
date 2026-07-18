namespace Speculum.Api.BrowserSessions.Models;

public sealed class ScreenResolution
{
    public int Width { get; set; }
    public int Height { get; set; }
}

public sealed class SessionConfig
{
    public ScreenResolution? Resolution { get; set; }
}
