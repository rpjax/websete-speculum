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
}
