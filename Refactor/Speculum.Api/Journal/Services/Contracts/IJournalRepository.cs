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
}
