using System.Text.Json;
using Websete.Speculum.Host.Config.Runtime;

namespace Websete.Speculum.Host.Config.Store;

public sealed class ConfigUpdateResult
{
    public bool Success { get; init; }
    public IReadOnlyList<string> Errors { get; init; } = [];
    public bool IsOperational { get; init; }
    public IReadOnlyList<string> MissingRequired { get; init; } = [];
}

public interface ISpeculumConfigStore
{
    SpeculumRuntimeConfig Current { get; }
    bool IsOperational { get; }
    IReadOnlyList<string> MissingRequired { get; }

    Task InitializeAsync(CancellationToken ct = default);
    Task<ConfigUpdateResult> PutSectionAsync(string key, JsonElement body, CancellationToken ct = default);
    Task<JsonElement?> GetSectionAsync(string key, CancellationToken ct = default);
    Task<ConfigUpdateResult> DeleteSectionAsync(string key, CancellationToken ct = default);
}
