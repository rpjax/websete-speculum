namespace Speculum.Api.Configurations.Models.Journal;

/// <summary>
/// Toggle map for non-canonical Journal facts. Canonical facts are never listed here.
/// </summary>
public sealed class JournalEventsConfiguration
{
    public const string SectionName = "JournalEvents";

    /// <summary>Fact type → enabled. Omitted types stay at catalog default (off for JournalFact).</summary>
    public Dictionary<string, bool> Events { get; set; } = new(StringComparer.Ordinal);
}
