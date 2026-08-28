using Speculum.Api.ResourceMonitoring.Models;

namespace Speculum.Api.ResourceMonitoring.Services.Contracts;

public interface IResourceSignalStore
{
    Task<ResourceListResponse<ResourceSignalDto>> ListAsync(
        ResourceSignalStatus? status,
        ResourceSignalKind? kind,
        CancellationToken ct = default);

    Task<ResourceSignalDto?> GetAsync(Guid id, CancellationToken ct = default);

    Task UpsertActiveAsync(ResourceSignalDto signal, CancellationToken ct = default);

    Task ResolveAsync(Guid id, DateTimeOffset resolvedAt, CancellationToken ct = default);

    Task<IReadOnlyList<ResourceSignalDto>> ListActiveByKindsAsync(
        IReadOnlyCollection<ResourceSignalKind> kinds,
        CancellationToken ct = default);
}
