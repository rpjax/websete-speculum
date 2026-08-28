using Speculum.Api.Journal.Models;

namespace Speculum.Api.Journal.Services.Contracts;

/// <summary>
/// In-process admission queue between <see cref="IJournalWriter.Append{T}"/> and the drain worker.
/// The channel is process-lifetime — it never completes.
/// </summary>
public interface IJournalQueue
{
    /// <summary>
    /// Enqueues a fact. Never blocks on store I/O.
    /// May drop BestEffort under soft/hard depth pressure.
    /// </summary>
    void Enqueue(JournalEntry entry);

    /// <summary>Approximate depth (metrics / tests).</summary>
    int Count { get; }

    /// <summary>
    /// Blocks until at least one entry is available, then returns up to
    /// <paramref name="maxCount"/> entries. Abort via <paramref name="cancellationToken"/>.
    /// Single reader only.
    /// </summary>
    ValueTask<IReadOnlyList<JournalEntry>> TakeBatchAsync(
        int maxCount,
        CancellationToken cancellationToken = default);
}
