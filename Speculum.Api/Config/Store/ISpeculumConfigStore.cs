using System.Text.Json;
using Speculum.Api.Config.Runtime;

namespace Speculum.Api.Config.Store;

public sealed class ConfigUpdateResult
{
    public bool Success { get; init; }
    public IReadOnlyList<string> Errors { get; init; } = [];
    public bool IsOperational { get; init; }
    public IReadOnlyList<string> MissingRequired { get; init; } = [];
    public bool IsSubdomainMirroringOperational { get; init; }
    public IReadOnlyList<string> MissingSubdomainMirroring { get; init; } = [];
}

public interface ISpeculumConfigStore
{
    SpeculumRuntimeConfig Current { get; }
    bool IsOperational { get; }
    IReadOnlyList<string> MissingRequired { get; }
    bool SubdomainMirroringEnabled { get; }
    bool IsSubdomainMirroringOperational { get; }
    IReadOnlyList<string> MissingSubdomainMirroring { get; }

    Task InitializeAsync(CancellationToken ct = default);
    Task<ConfigUpdateResult> PutSectionAsync(string key, JsonElement body, CancellationToken ct = default);
    Task<JsonElement?> GetSectionAsync(string key, CancellationToken ct = default);
    Task<ConfigUpdateResult> DeleteSectionAsync(string key, CancellationToken ct = default);
}
