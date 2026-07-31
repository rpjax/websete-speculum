using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Database;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Profiles.Retention;

public interface IRetentionPurgeExecutor
{
    /// <summary>Cleaner path: expired-only, one batch per tier.</summary>
    Task RunExpiredOnlyAsync(CancellationToken ct);

    /// <summary>Enforcer path: climb ladder and loop batches until relieved or cap.</summary>
    Task RunUnderPressureAsync(RetentionDegradationLevel level, CancellationToken ct);
}

public sealed class RetentionPurgeExecutor : IRetentionPurgeExecutor
{
    public const int DefaultBatchSize = 100;
    public const int MaxPressureBatches = 20;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IOptions<DatabaseOptions> _database;
    private readonly IHostEnvironment _environment;
    private readonly ILogger<RetentionPurgeExecutor> _logger;
    private readonly TimeProvider _time;

    public RetentionPurgeExecutor(
        IServiceScopeFactory scopeFactory,
        IOptions<DatabaseOptions> database,
        IHostEnvironment environment,
        ILogger<RetentionPurgeExecutor> logger,
        TimeProvider? time = null)
    {
        _scopeFactory = scopeFactory ?? throw new ArgumentNullException(nameof(scopeFactory));
        _database = database ?? throw new ArgumentNullException(nameof(database));
        _environment = environment ?? throw new ArgumentNullException(nameof(environment));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _time = time ?? TimeProvider.System;
    }

    public Task RunExpiredOnlyAsync(CancellationToken ct)
        => RunAsync(RetentionDegradationLevel.Profiles, loop: false, ct);

    public Task RunUnderPressureAsync(RetentionDegradationLevel level, CancellationToken ct)
        => RunAsync(level, loop: true, ct);

    private async Task RunAsync(RetentionDegradationLevel maxLevel, bool loop, CancellationToken ct)
    {
        if (maxLevel == RetentionDegradationLevel.None)
            return;

        var level = maxLevel;
        var batches = 0;
        do
        {
            var deleted = await RunOnePassAsync(level, ct).ConfigureAwait(false);
            batches++;
            if (!loop || deleted == 0 || batches >= MaxPressureBatches)
                break;

            var relieved = await MeasureLevelAsync(ct).ConfigureAwait(false);
            if (relieved == RetentionDegradationLevel.None)
                break;

            // May step down the ladder as usage drops.
            level = relieved;
        } while (!ct.IsCancellationRequested);
    }

    private async Task<RetentionDegradationLevel> MeasureLevelAsync(CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var configuration = sp.GetRequiredService<IConfigurationService>().GetCurrent();
        var budget = configuration.ResourceManagement.Storage.BudgetBytes;
        var journalEstimate = await sp.GetRequiredService<IJournalRepository>()
            .EstimateStoredBytesAsync(ct)
            .ConfigureAwait(false);
        var db = sp.GetRequiredService<SpeculumDbContext>();
        var used = await RetentionStorageUsage.MeasureBytesAsync(
                db,
                _database,
                _environment,
                journalEstimate,
                ct)
            .ConfigureAwait(false);
        return RetentionDegradation.FromUsage(used, budget);
    }

    private async Task<int> RunOnePassAsync(RetentionDegradationLevel maxLevel, CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var configuration = sp.GetRequiredService<IConfigurationService>().GetCurrent();
        var storage = configuration.ResourceManagement.Storage;
        var profilesCfg = configuration.ResourceManagement.Profiles;
        var journal = sp.GetRequiredService<IJournalRepository>();
        var profiles = sp.GetRequiredService<IProfileRepository>();
        var sessions = sp.GetRequiredService<ISessionRepository>();
        var db = sp.GetRequiredService<SpeculumDbContext>();
        var now = _time.GetUtcNow();
        var total = 0;

        if (maxLevel >= RetentionDegradationLevel.SessionTelemetry)
        {
            var cutoff = now - storage.SessionTelemetryRetention;
            var n = await journal.DeleteSessionIndexedOlderThanAsync(cutoff, DefaultBatchSize, ct)
                .ConfigureAwait(false);
            total += n;
            if (n > 0)
                _logger.LogInformation("Retention purged {Count} session-indexed journal rows", n);
        }

        if (maxLevel >= RetentionDegradationLevel.TelemetrySamples)
        {
            var cutoff = now - storage.TelemetrySampleRetention;
            var n = await journal.DeleteTelemetrySamplesOlderThanAsync(cutoff, DefaultBatchSize, ct)
                .ConfigureAwait(false);
            total += n;
            if (n > 0)
                _logger.LogInformation("Retention purged {Count} telemetry sample rows", n);
        }

        if (maxLevel >= RetentionDegradationLevel.JournalFacts)
        {
            var cutoff = now - storage.JournalFactRetention;
            var n = await journal.DeleteRemainingFactsOlderThanAsync(cutoff, DefaultBatchSize, ct)
                .ConfigureAwait(false);
            total += n;
            if (n > 0)
                _logger.LogInformation("Retention purged {Count} remaining journal facts", n);
        }

        if (maxLevel >= RetentionDegradationLevel.Profiles)
        {
            var olderThan = now - profilesCfg.InactiveRetentionPeriod;
            var live = await sessions.ListLiveProfileIdsAsync(ct).ConfigureAwait(false);
            var candidates = await profiles.ListExpiredInactiveAsync(
                    olderThan,
                    DefaultBatchSize,
                    live,
                    ct)
                .ConfigureAwait(false);

            var deleted = 0;
            foreach (var profileId in candidates)
            {
                if (await TryDeleteInactiveProfileAsync(db, profileId, ct).ConfigureAwait(false))
                    deleted++;
            }

            total += deleted;
            if (deleted > 0)
                _logger.LogInformation("Retention purged {Count} inactive profiles (LastUsedAt ASC)", deleted);
        }

        return total;
    }

    /// <summary>
    /// Atomic: delete non-live sessions, then profile only if no Live row exists.
    /// </summary>
    internal static async Task<bool> TryDeleteInactiveProfileAsync(
        SpeculumDbContext db,
        Guid profileId,
        CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct).ConfigureAwait(false);

        await db.Sessions
            .Where(s => s.ProfileId == profileId && s.State != LifecycleState.Live)
            .ExecuteDeleteAsync(ct)
            .ConfigureAwait(false);

        var hasLive = await db.Sessions
            .AsNoTracking()
            .AnyAsync(s => s.ProfileId == profileId && s.State == LifecycleState.Live, ct)
            .ConfigureAwait(false);
        if (hasLive)
        {
            await tx.RollbackAsync(ct).ConfigureAwait(false);
            return false;
        }

        var deleted = await db.Profiles
            .Where(p => p.Id == profileId)
            .ExecuteDeleteAsync(ct)
            .ConfigureAwait(false);

        if (deleted == 0)
        {
            await tx.RollbackAsync(ct).ConfigureAwait(false);
            return false;
        }

        await tx.CommitAsync(ct).ConfigureAwait(false);
        return true;
    }
}
