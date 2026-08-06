using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Speculum.Api.Database;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.Journal.Storage;

public sealed class JournalRepository : IJournalRepository
{
    private readonly SpeculumDbContext _db;
    private readonly ILogger<JournalRepository> _logger;

    public JournalRepository(SpeculumDbContext db, ILogger<JournalRepository> logger)
    {
        _db = db ?? throw new ArgumentNullException(nameof(db));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    private DbSet<JournalEntryRecord> Entries => _db.Set<JournalEntryRecord>();

    public async Task<int> SaveBatchAsync(
        IReadOnlyList<JournalEntry> entries,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(entries);
        if (entries.Count == 0)
            return 0;

        var ids = entries.Select(e => e.Id).Distinct().ToArray();
        var existing = await Entries
            .AsNoTracking()
            .Where(e => ids.Contains(e.Id))
            .Select(e => e.Id)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var existingSet = existing.Count == 0
            ? null
            : existing.ToHashSet();

        var toInsert = new List<JournalEntryRecord>(entries.Count);
        var seenInBatch = new HashSet<Guid>();
        foreach (var entry in entries)
        {
            if (!seenInBatch.Add(entry.Id))
                continue;

            if (existingSet is not null && existingSet.Contains(entry.Id))
                continue;

            toInsert.Add(JournalEntryMapper.ToRecord(entry));
        }

        if (toInsert.Count == 0)
        {
            _logger.LogDebug(
                "Journal SaveBatch skipped {Count} already-persisted Id(s).",
                entries.Count);
            return 0;
        }

        await using var tx = await _db.Database
            .BeginTransactionAsync(cancellationToken)
            .ConfigureAwait(false);

        try
        {
            Entries.AddRange(toInsert);
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            await tx.CommitAsync(cancellationToken).ConfigureAwait(false);
            return toInsert.Count;
        }
        catch (DbUpdateException ex) when (IsUniqueConstraint(ex))
        {
            await tx.RollbackAsync(CancellationToken.None).ConfigureAwait(false);
            _logger.LogDebug(ex, "Journal SaveBatch hit unique constraint; treating as idempotent.");
            return 0;
        }
        catch
        {
            try
            {
                await tx.RollbackAsync(CancellationToken.None).ConfigureAwait(false);
            }
            catch (Exception rollbackEx)
            {
                _logger.LogDebug(rollbackEx, "Journal SaveBatch rollback failed.");
            }

            throw;
        }
        finally
        {
            _db.ChangeTracker.Clear();
        }
    }

    public async Task<IReadOnlyList<JournalEntry>> ReadAsync(
        JournalQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        IQueryable<JournalEntryRecord> q = Entries
            .AsNoTracking()
            .Include(e => e.IndexKeys);

        q = ApplyFilter(q, query.Filter);
        q = ApplyOrders(q, query.Orders);

        var publishedSince = query.Filter?.PublishedSince;
        var publishedUntil = query.Filter?.PublishedUntil;
        var hasPublishedBounds = publishedSince is not null || publishedUntil is not null;

        // SQLite EF cannot translate DateTimeOffset range predicates on PublishedAt.
        // Apply those bounds in memory after ordered SQL materialization.
        if (!hasPublishedBounds)
        {
            if (query.Offset > 0)
                q = q.Skip(query.Offset);

            if (query.Limit is { } limit)
                q = q.Take(limit);

            var records = await q.ToListAsync(cancellationToken).ConfigureAwait(false);
            return records.Select(JournalEntryMapper.ToEntry).ToArray();
        }

        var take = query.Limit ?? 500;
        var offset = Math.Max(0, query.Offset);
        var matched = new List<JournalEntryRecord>(take);
        var skipped = 0;
        var scanned = 0;
        const int maxScan = 50_000;
        var batchSize = Math.Clamp(Math.Max(take * 4, 200), 200, 2_000);
        var descendingSequence = IsDescendingSequenceOrder(query.Orders);

        while (matched.Count < take && scanned < maxScan)
        {
            var batch = await q.Skip(scanned).Take(batchSize).ToListAsync(cancellationToken)
                .ConfigureAwait(false);
            if (batch.Count == 0)
                break;

            scanned += batch.Count;
            foreach (var row in batch)
            {
                if (publishedSince is { } since && row.PublishedAt < since)
                {
                    // Newest-first scans can stop once we pass the lower bound.
                    if (descendingSequence)
                        return matched.Select(JournalEntryMapper.ToEntry).ToArray();
                    continue;
                }

                if (publishedUntil is { } until && row.PublishedAt > until)
                    continue;

                if (skipped < offset)
                {
                    skipped++;
                    continue;
                }

                matched.Add(row);
                if (matched.Count >= take)
                    break;
            }
        }

        return matched.Select(JournalEntryMapper.ToEntry).ToArray();
    }

    public async Task<long> EstimateStoredBytesAsync(CancellationToken cancellationToken = default)
    {
        // Payload UTF-8 length proxy + fixed envelope overhead per row.
        var payload = await Entries.AsNoTracking()
            .SumAsync(e => (long)(e.Payload == null ? 0 : e.Payload.Length), cancellationToken)
            .ConfigureAwait(false);
        var count = await Entries.AsNoTracking().LongCountAsync(cancellationToken).ConfigureAwait(false);
        return payload + (count * 128);
    }

    public Task<int> DeleteSessionIndexedOlderThanAsync(
        DateTimeOffset olderThan,
        int take,
        CancellationToken cancellationToken = default)
        => DeleteOlderThanAsync(
            Entries.AsNoTracking()
                .Where(e => e.IndexKeys.Any(k => k.Type == "session")),
            olderThan,
            take,
            cancellationToken);

    public Task<int> DeleteTelemetrySamplesOlderThanAsync(
        DateTimeOffset olderThan,
        int take,
        CancellationToken cancellationToken = default)
        => DeleteOlderThanAsync(
            Entries.AsNoTracking()
                .Where(e => e.Type == "Telemetry.Sampling.SampleCollected"),
            olderThan,
            take,
            cancellationToken);

    public Task<int> DeleteRemainingFactsOlderThanAsync(
        DateTimeOffset olderThan,
        int take,
        CancellationToken cancellationToken = default)
        => DeleteOlderThanAsync(
            Entries.AsNoTracking()
                .Where(e => e.Type != "Telemetry.Sampling.SampleCollected"
                    && !e.IndexKeys.Any(k => k.Type == "session")),
            olderThan,
            take,
            cancellationToken);

    public async Task<int> DeleteByIndexKeyAsync(
        string indexKeyType,
        string indexKeyValue,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(indexKeyType);
        ArgumentException.ThrowIfNullOrWhiteSpace(indexKeyValue);

        var deleted = await Entries
            .Where(e => e.IndexKeys.Any(k => k.Type == indexKeyType && k.Value == indexKeyValue))
            .ExecuteDeleteAsync(cancellationToken)
            .ConfigureAwait(false);
        _db.ChangeTracker.Clear();
        return deleted;
    }

    public async Task<int> DeleteIndependentFactsAsync(
        string? type,
        DateTimeOffset? olderThan,
        CancellationToken cancellationToken = default)
    {
        IQueryable<JournalEntryRecord> source = Entries
            .AsNoTracking()
            .Where(e => !e.IndexKeys.Any(k => k.Type == "session"));

        if (!string.IsNullOrWhiteSpace(type))
            source = source.Where(e => e.Type == type);

        if (olderThan is null)
        {
            var deletedAll = await source.ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
            _db.ChangeTracker.Clear();
            return deletedAll;
        }

        // PublishedAt range predicates are not SQLite-translatable; filter in memory
        // then delete by Sequence (same technique as DeleteOlderThanAsync below).
        var candidates = await source
            .Select(e => new { e.Sequence, e.PublishedAt })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var sequences = candidates
            .Where(e => e.PublishedAt < olderThan.Value)
            .Select(e => e.Sequence)
            .ToArray();

        if (sequences.Length == 0)
            return 0;

        var deleted = await Entries
            .Where(e => sequences.Contains(e.Sequence))
            .ExecuteDeleteAsync(cancellationToken)
            .ConfigureAwait(false);
        _db.ChangeTracker.Clear();
        return deleted;
    }

    public Task<int> CountByIndexKeyAsync(
        string indexKeyType,
        string indexKeyValue,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(indexKeyType);
        ArgumentException.ThrowIfNullOrWhiteSpace(indexKeyValue);

        return Entries
            .AsNoTracking()
            .Where(e => e.IndexKeys.Any(k => k.Type == indexKeyType && k.Value == indexKeyValue))
            .CountAsync(cancellationToken);
    }

    public async Task<int> CountIndependentFactsAsync(
        string? type,
        DateTimeOffset? olderThan,
        CancellationToken cancellationToken = default)
    {
        IQueryable<JournalEntryRecord> source = Entries
            .AsNoTracking()
            .Where(e => !e.IndexKeys.Any(k => k.Type == "session"));

        if (!string.IsNullOrWhiteSpace(type))
            source = source.Where(e => e.Type == type);

        if (olderThan is null)
            return await source.CountAsync(cancellationToken).ConfigureAwait(false);

        var publishedAts = await source
            .Select(e => e.PublishedAt)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        return publishedAts.Count(p => p < olderThan.Value);
    }

    private async Task<int> DeleteOlderThanAsync(
        IQueryable<JournalEntryRecord> source,
        DateTimeOffset olderThan,
        int take,
        CancellationToken cancellationToken)
    {
        // PublishedAt range predicates are not SQLite-translatable; order + client filter.
        // SQLite cannot ORDER BY DateTimeOffset (or UtcTicks) — Sequence is the durable publish order.
        var candidates = await source
            .AsNoTracking()
            .OrderBy(e => e.Sequence)
            .Take(Math.Max(take * 4, take))
            .Select(e => new { e.Sequence, e.PublishedAt })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var sequences = candidates
            .Where(e => e.PublishedAt < olderThan)
            .Select(e => e.Sequence)
            .Take(take)
            .ToArray();

        if (sequences.Length == 0)
            return 0;

        var deleted = await Entries
            .Where(e => sequences.Contains(e.Sequence))
            .ExecuteDeleteAsync(cancellationToken)
            .ConfigureAwait(false);
        _db.ChangeTracker.Clear();
        return deleted;
    }

    private async Task<int> DeleteBySequencesAsync(
        IQueryable<long> sequenceQuery,
        CancellationToken cancellationToken)
    {
        var sequences = await sequenceQuery.ToListAsync(cancellationToken).ConfigureAwait(false);
        if (sequences.Count == 0)
            return 0;

        var deleted = await Entries
            .Where(e => sequences.Contains(e.Sequence))
            .ExecuteDeleteAsync(cancellationToken)
            .ConfigureAwait(false);
        _db.ChangeTracker.Clear();
        return deleted;
    }

    private static bool IsDescendingSequenceOrder(IReadOnlyList<JournalQueryOrder> orders)
    {
        if (orders.Count == 0)
            return false;
        var primary = orders[0];
        // PublishedAt sorts by Sequence (SQLite cannot ORDER BY DateTimeOffset).
        return (primary.Property == JournalOrderProperty.Sequence
                || primary.Property == JournalOrderProperty.PublishedAt)
            && primary.Direction == JournalSortDirection.Descending;
    }

    private static bool IsUniqueConstraint(DbUpdateException ex)
    {
        for (Exception? e = ex; e is not null; e = e.InnerException)
        {
            if (e is SqliteException sqlite
                && (sqlite.SqliteErrorCode == 19 || sqlite.SqliteExtendedErrorCode == 2067))
            {
                return true;
            }

            var message = e.Message;
            if (message.Contains("UNIQUE", StringComparison.OrdinalIgnoreCase)
                || message.Contains("unique constraint", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static IQueryable<JournalEntryRecord> ApplyFilter(
        IQueryable<JournalEntryRecord> query,
        JournalQueryFilter? filter)
    {
        if (filter is null)
            return query;

        if (filter.AfterSequence is { } after)
            query = query.Where(e => e.Sequence > after);

        if (filter.BeforeSequence is { } before)
            query = query.Where(e => e.Sequence < before);

        if (filter.Id is { } id)
            query = query.Where(e => e.Id == id);

        if (!string.IsNullOrWhiteSpace(filter.Type))
            query = query.Where(e => e.Type == filter.Type);

        if (filter.SchemaVersion is { } version)
            query = query.Where(e => e.SchemaVersion == version);

        if (filter.PublishPolicy is { } policy)
            query = query.Where(e => e.PublishPolicy == policy);

        // PublishedSince/Until are applied in ReadAsync (SQLite cannot translate them).

        foreach (var key in filter.IndexKeys)
        {
            var type = key.Type;
            var value = key.Value;
            query = query.Where(e => e.IndexKeys.Any(k => k.Type == type && k.Value == value));
        }

        foreach (var keyType in filter.IndexKeyTypes)
        {
            var type = keyType;
            query = query.Where(e => e.IndexKeys.Any(k => k.Type == type));
        }

        return query;
    }

    private static IQueryable<JournalEntryRecord> ApplyOrders(
        IQueryable<JournalEntryRecord> query,
        IReadOnlyList<JournalQueryOrder> orders)
    {
        if (orders.Count == 0)
            return query.OrderBy(e => e.Sequence);

        IOrderedQueryable<JournalEntryRecord>? ordered = null;

        foreach (var order in orders)
        {
            if (order.Property is null && string.IsNullOrWhiteSpace(order.IndexKeyType))
            {
                throw new ArgumentException(
                    "JournalQueryOrder requires Property or IndexKeyType.",
                    nameof(orders));
            }

            if (order.Property is { } property)
            {
                ordered = property switch
                {
                    JournalOrderProperty.Sequence => ApplyOrder(
                        ordered, query, order.Direction, e => e.Sequence),
                    // SQLite cannot ORDER BY DateTimeOffset / UtcTicks. Sequence is assigned
                    // at publish time and is the durable chronological key in this store.
                    JournalOrderProperty.PublishedAt => ApplyOrder(
                        ordered, query, order.Direction, e => e.Sequence),
                    _ => throw new ArgumentOutOfRangeException(
                        nameof(orders),
                        property,
                        "Unsupported JournalOrderProperty."),
                };
                continue;
            }

            var keyType = order.IndexKeyType!;
            ordered = ApplyOrder(
                ordered,
                query,
                order.Direction,
                e => e.IndexKeys
                    .Where(k => k.Type == keyType)
                    .Select(k => k.Value)
                    .FirstOrDefault());
        }

        return ordered ?? query.OrderBy(e => e.Sequence);
    }

    private static IOrderedQueryable<JournalEntryRecord> ApplyOrder<TKey>(
        IOrderedQueryable<JournalEntryRecord>? ordered,
        IQueryable<JournalEntryRecord> source,
        JournalSortDirection direction,
        System.Linq.Expressions.Expression<Func<JournalEntryRecord, TKey>> keySelector)
    {
        if (ordered is null)
        {
            return direction == JournalSortDirection.Descending
                ? source.OrderByDescending(keySelector)
                : source.OrderBy(keySelector);
        }

        return direction == JournalSortDirection.Descending
            ? ordered.ThenByDescending(keySelector)
            : ordered.ThenBy(keySelector);
    }
}
