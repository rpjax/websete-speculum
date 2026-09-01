using Speculum.Api.Journal.Models;

namespace Speculum.Api.Journal.Services.Contracts;

/// <summary>
/// Application read port over Journal facts (typically durable store; eventually consistent with drain).
/// </summary>
/// <remarks>
/// Queries are envelope- and index-oriented. Do not expect payload JSON path filters here.
/// See <see cref="JournalQuery"/> / <see cref="JournalQueryFilter"/> for semantics.
/// </remarks>
public interface IJournalReader
{
    Task<IReadOnlyList<JournalEntry>> ReadAsync(
        JournalQuery? query = null,
        CancellationToken cancellationToken = default);
}
