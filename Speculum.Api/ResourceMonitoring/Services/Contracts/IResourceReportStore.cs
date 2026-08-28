using Speculum.Api.ResourceMonitoring.Models;

namespace Speculum.Api.ResourceMonitoring.Services.Contracts;

public interface IResourceReportStore
{
    Task<ResourceListResponse<ResourceReportDto>> ListAsync(
        ResourceReportKind? kind,
        CancellationToken ct = default);

    Task<ResourceReportDto?> GetAsync(Guid id, CancellationToken ct = default);

    Task<ResourceReportDto> CreatePendingAsync(
        ResourceReportKind kind,
        DateTimeOffset from,
        DateTimeOffset to,
        CancellationToken ct = default);

    Task MarkReadyAsync(
        Guid id,
        string summary,
        IReadOnlyList<ResourceReportChapterDto> chapters,
        DateTimeOffset readyAt,
        CancellationToken ct = default);

    Task MarkFailedAsync(
        Guid id,
        string errorCode,
        string phase,
        CancellationToken ct = default);
}

public interface IResourceReportQueue
{
    ValueTask EnqueueAsync(Guid reportId, CancellationToken ct = default);

    IAsyncEnumerable<Guid> ReadAllAsync(CancellationToken ct);
}
