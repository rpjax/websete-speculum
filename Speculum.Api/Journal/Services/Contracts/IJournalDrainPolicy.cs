using Speculum.Api.Journal.Models;

namespace Speculum.Api.Journal.Services.Contracts;

public interface IJournalDrainPolicy
{
    JournalDrainDecision Decide(
        IReadOnlyList<JournalEntry> batch,
        JournalHealthState health,
        JournalDrainOptions options);
}
