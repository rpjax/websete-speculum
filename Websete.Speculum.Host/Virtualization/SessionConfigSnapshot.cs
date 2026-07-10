using Websete.Speculum.Host.Virtualization.Sidecar;

namespace Websete.Speculum.Host.Virtualization;

/// <summary>
/// Immutable per-session configuration snapshot taken at <c>StartSessionAsync</c>.
/// </summary>
public sealed class SessionConfigSnapshot
{
    public required string InitialUrl { get; init; }
    public IReadOnlyList<ScriptPayload> Scripts { get; init; } = [];
    public bool JsBridgeEnabled { get; init; }
    public string[] AllowedNavigationDomains { get; init; } = [];
}
