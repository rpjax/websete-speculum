using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Motor.Sidecar;

namespace Speculum.Api.Config.Runtime;

public sealed class SpeculumRuntimeConfig
{
    public string AdminApiKey { get; init; } = "";
    public ForwardingOptions? Forwarding { get; init; }
    public int? MaxSessions { get; init; }
    public IReadOnlyList<ScriptInjectionEntry> ScriptInjection { get; init; } = [];
    public bool JsBridgeEnabled { get; init; }
    public IReadOnlyList<ScriptPayload> ResolvedScripts { get; init; } = [];
    public HostingOptions Hosting { get; init; } = new();
    public IReadOnlyList<HostingProfileStatus> HostingProfileStatuses { get; init; } = [];
    public DiagnosticsOptions Diagnostics { get; init; } = new();
}
