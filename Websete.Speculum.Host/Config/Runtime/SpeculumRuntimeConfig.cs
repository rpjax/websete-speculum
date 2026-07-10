using Websete.Speculum.Host.Virtualization.Sidecar;

namespace Websete.Speculum.Host.Config.Runtime;

public sealed class SpeculumRuntimeConfig
{
    public string AdminApiKey { get; init; } = "";
    public ForwardingOptions? Forwarding { get; init; }
    public int? MaxSessions { get; init; }
    public IReadOnlyList<ScriptInjectionEntry> ScriptInjection { get; init; } = [];
    public bool JsBridgeEnabled { get; init; }
    public IReadOnlyList<ScriptPayload> ResolvedScripts { get; init; } = [];
}
