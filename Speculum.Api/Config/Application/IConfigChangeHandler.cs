using Speculum.Api.Config.Store;

namespace Speculum.Api.Config.Application;

public enum ConfigChangePhase
{
    PreReload,
    PostReload,
}

public sealed class ConfigChangeContext
{
    public required string SectionKey { get; init; }
    public required ConfigChangePhase Phase { get; init; }
    public required ConfigUpdateResult Result { get; init; }
}

public interface IConfigChangeHandler
{
    Task HandleAsync(ConfigChangeContext context, CancellationToken ct = default);
}
