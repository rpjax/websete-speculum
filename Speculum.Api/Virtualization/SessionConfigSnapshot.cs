using Speculum.Api.Virtualization.Sidecar;

namespace Speculum.Api.Virtualization;

/// <summary>
/// Immutable per-session configuration snapshot taken at <c>StartSessionAsync</c>.
/// </summary>
public sealed class SessionConfigSnapshot
{
    public required string InitialUrl { get; init; }
    public int Width { get; init; } = 1280;
    public int Height { get; init; } = 720;
    public Persistence.BrowserStatePayload? BrowserState { get; init; }
    public IReadOnlyList<ScriptPayload> Scripts { get; init; } = [];
    public bool JsBridgeEnabled { get; init; }
    public string[] AllowedNavigationDomains { get; init; } = [];
}
