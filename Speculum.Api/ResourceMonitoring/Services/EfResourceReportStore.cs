using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Speculum.Api.Database;
using Speculum.Api.ResourceMonitoring.Models;
using Speculum.Api.ResourceMonitoring.Services.Contracts;
using Speculum.Api.ResourceMonitoring.Storage;

namespace Speculum.Api.ResourceMonitoring.Services;

public sealed class EfResourceReportStore(SpeculumDbContext db, TimeProvider time) : IResourceReportStore
{
    public async Task<ResourceListResponse<ResourceReportDto>> ListAsync(
        ResourceReportKind? kind,
        CancellationToken ct = default)
    {
        var query = db.ResourceReports.AsNoTracking().AsQueryable();
        if (kind is not null)
            query = query.Where(r => r.Kind == ResourceMonitoringJson.SerializeEnum(kind.Value));

        var total = await query.CountAsync(ct).ConfigureAwait(false);
        var rows = await query
            .OrderByDescending(r => r.CreatedAt)
            .Take(200)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        return new ResourceListResponse<ResourceReportDto>
        {
            Items = rows.Select(ResourceMonitoringJson.ToDto).ToList(),
            Total = total,
        };
    }

    public async Task<ResourceReportDto?> GetAsync(Guid id, CancellationToken ct = default)
    {
        var row = await db.ResourceReports.AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == id, ct)
            .ConfigureAwait(false);
        return row is null ? null : ResourceMonitoringJson.ToDto(row);
    }

    public async Task<ResourceReportDto> CreatePendingAsync(
        ResourceReportKind kind,
        DateTimeOffset from,
        DateTimeOffset to,
        CancellationToken ct = default)
    {
        var now = time.GetUtcNow();
        var record = new ResourceReportRecord
        {
            Id = Guid.NewGuid(),
            Kind = ResourceMonitoringJson.SerializeEnum(kind),
            Status = ResourceMonitoringJson.SerializeEnum(ResourceReportStatus.Pending),
            From = from,
            To = to,
            CreatedAt = now,
            Summary = "",
            ChaptersJson = "[]",
        };
        db.ResourceReports.Add(record);
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
        return ResourceMonitoringJson.ToDto(record);
    }

    public async Task MarkReadyAsync(
        Guid id,
        string summary,
        IReadOnlyList<ResourceReportChapterDto> chapters,
        DateTimeOffset readyAt,
        CancellationToken ct = default)
    {
        var row = await db.ResourceReports.FirstOrDefaultAsync(r => r.Id == id, ct).ConfigureAwait(false);
        if (row is null)
            return;

        row.Status = ResourceMonitoringJson.SerializeEnum(ResourceReportStatus.Ready);
        row.Summary = summary;
        row.ChaptersJson = JsonSerializer.Serialize(chapters, ResourceMonitoringJson.Options);
        row.ReadyAt = readyAt;
        row.ErrorJson = null;
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    public async Task MarkFailedAsync(
        Guid id,
        string errorCode,
        string phase,
        CancellationToken ct = default)
    {
        var row = await db.ResourceReports.FirstOrDefaultAsync(r => r.Id == id, ct).ConfigureAwait(false);
        if (row is null)
            return;

        row.Status = ResourceMonitoringJson.SerializeEnum(ResourceReportStatus.Failed);
        row.ErrorJson = JsonSerializer.Serialize(
            new ResourceReportErrorDto { ErrorCode = errorCode, Phase = phase },
            ResourceMonitoringJson.Options);
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }
}
