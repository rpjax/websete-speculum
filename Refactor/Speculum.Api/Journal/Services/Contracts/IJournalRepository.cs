using Speculum.Api.Journal.Models;

namespace Speculum.Api.Journal.Services.Contracts;

/// <summary>
/// Durable store seam for Journal drain and reads.
/// </summary>
public interface IJournalRepository
{
    /// <summary>
    /// Persists a batch atomically. Skips Ids that already exist (idempotent retry).
    /// Returns the number of newly inserted rows.
    /// </summary>
    Task<int> SaveBatchAsync(
        IReadOnlyList<JournalEntry> entries,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Reads persisted entries matching <paramref name="query"/> (envelope/index filters only).
    /// </summary>
    Task<IReadOnlyList<JournalEntry>> ReadAsync(
        JournalQuery query,
        CancellationToken cancellationToken = default);

    /// <summary>Approximate durable journal payload bytes (payload lengths + envelope overhead).</summary>
    Task<long> EstimateStoredBytesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes oldest entries with a <c>session</c> index key published before <paramref name="olderThan"/>.
    /// </summary>
    Task<int> DeleteSessionIndexedOlderThanAsync(
        DateTimeOffset olderThan,
        int take,
        CancellationToken cancellationToken = default);

    /// <summary>Deletes oldest <c>Telemetry.Sampling.SampleCollected</c> rows before cutoff.</summary>
    Task<int> DeleteTelemetrySamplesOlderThanAsync(
        DateTimeOffset olderThan,
        int take,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes remaining journal facts older than cutoff (excludes session-indexed and SampleCollected).
    /// </summary>
    Task<int> DeleteRemainingFactsOlderThanAsync(
        DateTimeOffset olderThan,
        int take,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes every entry carrying the given index key (any age). Reserved for the
    /// Maintenance session-delete cascade — the only sanctioned caller — since it can
    /// remove session-associated facts, which no other deletion path may do.
    /// </summary>
    Task<int> DeleteByIndexKeyAsync(
        string indexKeyType,
        string indexKeyValue,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes facts that do NOT carry a <c>session</c> index key, optionally narrowed by
    /// fact <paramref name="type"/> and/or a <paramref name="olderThan"/> cutoff. This is the
    /// only deletion path exposed for "independent" facts — it structurally cannot touch a
    /// session-associated fact, enforcing the rule at the query level.
    /// </summary>
    Task<int> DeleteIndependentFactsAsync(
        string? type,
        DateTimeOffset? olderThan,
        CancellationToken cancellationToken = default);

    /// <summary>Count of facts carrying the given index key (dry-run / summary display).</summary>
    Task<int> CountByIndexKeyAsync(
        string indexKeyType,
        string indexKeyValue,
        CancellationToken cancellationToken = default);

    /// <summary>Count of facts eligible for <see cref="DeleteIndependentFactsAsync"/> (dry-run / summary display).</summary>
    Task<int> CountIndependentFactsAsync(
        string? type,
        DateTimeOffset? olderThan,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Hard-deletes every journal entry (any index). Reserved for Maintenance Lab Reset only.
    /// </summary>
    Task<int> DeleteAllAsync(CancellationToken cancellationToken = default);
}
