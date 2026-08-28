using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.Journal.Services;

/// <summary>
/// Pure drain policy: Guaranteed before BestEffort; shed BestEffort under Degraded.
/// </summary>
public sealed class JournalDrainPolicy : IJournalDrainPolicy
{
    public JournalDrainDecision Decide(
        IReadOnlyList<JournalEntry> batch,
        JournalHealthState health,
        JournalDrainOptions options)
    {
        ArgumentNullException.ThrowIfNull(batch);
        ArgumentNullException.ThrowIfNull(options);

        if (batch.Count == 0)
        {
            return new JournalDrainDecision
            {
                Persist = Array.Empty<JournalEntry>(),
                Drop = Array.Empty<JournalEntry>(),
            };
        }

        var guaranteed = new List<JournalEntry>();
        var bestEffort = new List<JournalEntry>();

        foreach (var entry in batch)
        {
            if (entry.PublishPolicy == PublishPolicy.Guaranteed)
                guaranteed.Add(entry);
            else
                bestEffort.Add(entry);
        }

        if (health == JournalHealthState.Healthy)
        {
            var persist = new List<JournalEntry>(guaranteed.Count + bestEffort.Count);
            persist.AddRange(guaranteed);
            persist.AddRange(bestEffort);
            return new JournalDrainDecision
            {
                Persist = persist,
                Drop = Array.Empty<JournalEntry>(),
            };
        }

        var keepBe = Math.Max(0, options.DegradedBestEffortKeep);
        IReadOnlyList<JournalEntry> keepBestEffort;
        IReadOnlyList<JournalEntry> dropBestEffort;

        if (keepBe <= 0 || bestEffort.Count == 0)
        {
            keepBestEffort = Array.Empty<JournalEntry>();
            dropBestEffort = bestEffort;
        }
        else if (bestEffort.Count <= keepBe)
        {
            // Newest BestEffort preferred: take from the end of admission order in batch.
            keepBestEffort = bestEffort;
            dropBestEffort = Array.Empty<JournalEntry>();
        }
        else
        {
            keepBestEffort = bestEffort.Skip(bestEffort.Count - keepBe).ToArray();
            dropBestEffort = bestEffort.Take(bestEffort.Count - keepBe).ToArray();
        }

        var persistDegraded = new List<JournalEntry>(guaranteed.Count + keepBestEffort.Count);
        persistDegraded.AddRange(guaranteed);
        persistDegraded.AddRange(keepBestEffort);

        return new JournalDrainDecision
        {
            Persist = persistDegraded,
            Drop = dropBestEffort,
        };
    }
}
