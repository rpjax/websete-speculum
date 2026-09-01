using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Speculum.Api.Database;
using Speculum.Api.ResourceMonitoring.Models;
using Speculum.Api.ResourceMonitoring.Services.Contracts;
using Speculum.Api.ResourceMonitoring.Storage;

namespace Speculum.Api.ResourceMonitoring.Services;

public sealed class EfResourceSignalStore(SpeculumDbContext db) : IResourceSignalStore
{
    public async Task<ResourceListResponse<ResourceSignalDto>> ListAsync(
        ResourceSignalStatus? status,
        ResourceSignalKind? kind,
        CancellationToken ct = default)
    {
        var query = db.ResourceSignals.AsNoTracking().AsQueryable();
        if (status is not null)
            query = query.Where(s => s.Status == ResourceMonitoringJson.SerializeEnum(status.Value));
        if (kind is not null)
            query = query.Where(s => s.Kind == ResourceMonitoringJson.SerializeEnum(kind.Value));

        var total = await query.CountAsync(ct).ConfigureAwait(false);
        var rows = await query
            .OrderByDescending(s => s.DetectedAt)
            .Take(500)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        return new ResourceListResponse<ResourceSignalDto>
        {
            Items = rows.Select(ResourceMonitoringJson.ToDto).ToList(),
            Total = total,
        };
    }

    public async Task<ResourceSignalDto?> GetAsync(Guid id, CancellationToken ct = default)
    {
        var row = await db.ResourceSignals.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == id, ct)
            .ConfigureAwait(false);
        return row is null ? null : ResourceMonitoringJson.ToDto(row);
    }

    public async Task UpsertActiveAsync(ResourceSignalDto signal, CancellationToken ct = default)
    {
        var kind = ResourceMonitoringJson.SerializeEnum(signal.Kind);
        var existing = await db.ResourceSignals
            .FirstOrDefaultAsync(
                s => s.Kind == kind && s.Status == ResourceMonitoringJson.SerializeEnum(ResourceSignalStatus.Active),
                ct)
            .ConfigureAwait(false);

        if (existing is null)
        {
            db.ResourceSignals.Add(ToRecord(signal));
        }
        else
        {
            existing.Severity = ResourceMonitoringJson.SerializeEnum(signal.Severity);
            existing.Phase = signal.Phase;
            existing.Summary = signal.Summary;
            existing.EvidenceSampleIdsJson = JsonSerializer.Serialize(signal.EvidenceSampleIds, ResourceMonitoringJson.Options);
            existing.MetricsJson = JsonSerializer.Serialize(signal.Metrics, ResourceMonitoringJson.Options);
            existing.ChartHintJson = signal.ChartHint is null
                ? null
                : JsonSerializer.Serialize(signal.ChartHint, ResourceMonitoringJson.Options);
        }

        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    public async Task ResolveAsync(Guid id, DateTimeOffset resolvedAt, CancellationToken ct = default)
    {
        var row = await db.ResourceSignals.FirstOrDefaultAsync(s => s.Id == id, ct).ConfigureAwait(false);
        if (row is null)
            return;

        row.Status = ResourceMonitoringJson.SerializeEnum(ResourceSignalStatus.Resolved);
        row.ResolvedAt = resolvedAt;
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<ResourceSignalDto>> ListActiveByKindsAsync(
        IReadOnlyCollection<ResourceSignalKind> kinds,
        CancellationToken ct = default)
    {
        var kindNames = kinds.Select(ResourceMonitoringJson.SerializeEnum).ToHashSet(StringComparer.Ordinal);
        var active = ResourceMonitoringJson.SerializeEnum(ResourceSignalStatus.Active);
        var rows = await db.ResourceSignals.AsNoTracking()
            .Where(s => s.Status == active && kindNames.Contains(s.Kind))
            .ToListAsync(ct)
            .ConfigureAwait(false);
        return rows.Select(ResourceMonitoringJson.ToDto).ToList();
    }

    private static ResourceSignalRecord ToRecord(ResourceSignalDto signal) => new()
    {
        Id = signal.Id == Guid.Empty ? Guid.NewGuid() : signal.Id,
        Kind = ResourceMonitoringJson.SerializeEnum(signal.Kind),
        Severity = ResourceMonitoringJson.SerializeEnum(signal.Severity),
        Status = ResourceMonitoringJson.SerializeEnum(signal.Status),
        Phase = signal.Phase,
        Summary = signal.Summary,
        DetectedAt = signal.DetectedAt,
        ResolvedAt = signal.ResolvedAt,
        EvidenceSampleIdsJson = JsonSerializer.Serialize(signal.EvidenceSampleIds, ResourceMonitoringJson.Options),
        MetricsJson = JsonSerializer.Serialize(signal.Metrics, ResourceMonitoringJson.Options),
        ChartHintJson = signal.ChartHint is null
            ? null
            : JsonSerializer.Serialize(signal.ChartHint, ResourceMonitoringJson.Options),
    };
}
