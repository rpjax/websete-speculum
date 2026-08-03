using Speculum.Api.ResourceMonitoring.Models;

namespace Speculum.Api.ResourceMonitoring.Services.Contracts;

public interface IResourceHistoryService
{
    Task<ResourceLatestResponse> GetLatestAsync(CancellationToken ct = default);

    Task<ResourceHistoryResponse> GetHistoryAsync(
        DateTimeOffset from,
        DateTimeOffset to,
        int? limit,
        int? bucketSeconds,
        string? cursor,
        CancellationToken ct = default);
}
