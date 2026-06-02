namespace Websete.Speculum.Host.Virtualization.Options;

public class VirtualBrowserConnectionOptions
{
    public int     Width           { get; init; } = 1280;
    public int     Height          { get; init; } = 720;
    public string? InitialUrl      { get; init; }
    public bool    JsBridgeEnabled { get; init; }
}
