using Speculum.Api.Virtualization.Sidecar;

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

    /// <summary>Legacy — true if any profile has mirroring enabled.</summary>
    public bool SubdomainMirroringEnabled { get; init; }

    /// <summary>Legacy — true if any profile mirroring is operational.</summary>
    public bool IsSubdomainMirroringOperational { get; init; }

    public IReadOnlyList<string> MissingSubdomainMirroring { get; init; } = [];
}
