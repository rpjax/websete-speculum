using Websete.Speculum.Host.Virtualization.Sidecar;

namespace Websete.Speculum.Host.Virtualization.Options;

public class VirtualBrowserConnectionOptions
{
    public int     Width           { get; init; } = 1280;
    public int     Height          { get; init; } = 720;
    public string? InitialUrl      { get; init; }
    public bool    JsBridgeEnabled { get; init; }

    /// <summary>
    /// Scripts to inject into every page of the virtual browser session.
    /// Populated at startup from <c>ScriptInjection</c> config — content
    /// is read from wwwroot so the sidecar never needs disk access to the host.
    /// </summary>
    public IReadOnlyList<ScriptPayload> Scripts { get; init; } = [];
}
