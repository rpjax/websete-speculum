using Speculum.Api.Journal.Models;

namespace Speculum.Api.Journal.Services;

/// <summary>
/// Outcome of drain policy for one batch.
/// </summary>
public sealed class JournalDrainDecision
{
    public required IReadOnlyList<JournalEntry> Persist { get; init; }
    public required IReadOnlyList<JournalEntry> Drop { get; init; }
}
