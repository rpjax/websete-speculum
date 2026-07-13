using Speculum.Api.BrowserPersistence;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Motor.Sidecar;

namespace Speculum.Api.Motor.Live;

/// <summary>
/// Immutable per-session configuration snapshot taken at <c>StartSessionAsync</c>.
/// </summary>
public sealed class SessionConfigSnapshot
{
    public required string InitialUrl { get; init; }
    public int Width { get; init; } = 1280;
    public int Height { get; init; } = 720;
    public BrowserStatePayload? BrowserState { get; init; }
    public IReadOnlyList<ScriptPayload> Scripts { get; init; } = [];
    public bool JsBridgeEnabled { get; init; }
    public string[] AllowedNavigationDomains { get; init; } = [];
    public HostingProfileOptions? HostingProfile { get; init; }
    public ForwardingOptions? Forwarding { get; init; }
    public string MotorRequestHost { get; init; } = "";
}
