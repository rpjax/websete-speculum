namespace Speculum.Api.Sessions.Models;

/// <summary>
/// Confirmed geometry from the sidecar <c>ready</c> handshake after launch.
/// </summary>
public sealed class BrowserReadyInfo
{
    public required int Width { get; init; }

    public required int Height { get; init; }
}
