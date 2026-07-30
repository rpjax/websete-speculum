using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Speculum.Api.Database;
using Speculum.Api.HostResources.Models;
using Speculum.Api.HostResources.Services.Contracts;

namespace Speculum.Api.HostResources.Storage;

public sealed class EfHostResourceApplyStore(SpeculumDbContext db) : IHostResourceApplyStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<HostResourceLastApplySnapshot?> GetLastAsync(CancellationToken ct = default)
    {
        var row = await db.HostResourceApplies
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == 1, ct)
            .ConfigureAwait(false);

        if (row is null)
            return null;

        var warnings = DeserializeWarnings(row.WarningsJson);
        return new HostResourceLastApplySnapshot(
            Params: new HostResourceProvisionParams
            {
                MaxRamBytes = row.MaxRamBytes,
                ReservePercent = row.ReservePercent,
                ReserveMinBytes = row.ReserveMinBytes,
                ShmMinBytes = row.ShmMinBytes,
                ShmMaxPercentOfBudget = row.ShmMaxPercentOfBudget,
                RaiseUlimits = row.RaiseUlimits,
                Nofile = row.Nofile,
                Nproc = row.Nproc,
            },
            BudgetBytes: row.BudgetBytes,
            ReserveBytes: row.ReserveBytes,
            ShmTargetBytes: row.ShmTargetBytes,
            ShmAppliedBytes: row.ShmAppliedBytes,
            HostMemoryTotalBytes: row.HostMemoryTotalBytes,
            HostCpuCount: row.HostCpuCount,
            HostSource: row.HostSource,
            UlimitsRaised: row.UlimitsRaised,
            Warnings: warnings,
            AppliedAtUtc: row.AppliedAtUtc);
    }

    public async Task SaveAsync(HostResourceApplyResult result, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(result);

        var row = await db.HostResourceApplies
            .FirstOrDefaultAsync(x => x.Id == 1, ct)
            .ConfigureAwait(false);

        if (row is null)
        {
            row = new HostResourceApplyRecord { Id = 1 };
            db.HostResourceApplies.Add(row);
        }

        var p = result.Plan.Params;
        row.MaxRamBytes = p.MaxRamBytes;
        row.ReservePercent = p.ReservePercent;
        row.ReserveMinBytes = p.ReserveMinBytes;
        row.ShmMinBytes = p.ShmMinBytes;
        row.ShmMaxPercentOfBudget = p.ShmMaxPercentOfBudget;
        row.RaiseUlimits = p.RaiseUlimits;
        row.Nofile = p.Nofile;
        row.Nproc = p.Nproc;
        row.BudgetBytes = result.Plan.BudgetBytes;
        row.ReserveBytes = result.Plan.ReserveBytes;
        row.ShmTargetBytes = result.Plan.ShmTargetBytes;
        row.ShmAppliedBytes = result.ShmAppliedBytes;
        row.HostMemoryTotalBytes = result.Plan.HostMemoryTotalBytes;
        row.HostCpuCount = result.Plan.HostCpuCount;
        row.HostSource = result.Plan.HostSource;
        row.UlimitsRaised = result.UlimitsRaised;
        row.WarningsJson = JsonSerializer.Serialize(result.Warnings, JsonOptions);
        row.AppliedAtUtc = result.AppliedAtUtc;

        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    private static IReadOnlyList<string> DeserializeWarnings(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json, JsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}
