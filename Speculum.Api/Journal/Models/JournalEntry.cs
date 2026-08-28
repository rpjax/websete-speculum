namespace Speculum.Api.Journal.Models;

/// <summary>
/// Application-model envelope for one Journal fact.
/// </summary>
/// <remarks>
/// <para>
/// The Journal records operational facts. It is not an event-sourcing log: aggregate
/// state must not be rebuilt from Journal entries.
/// </para>
/// <para>
/// The envelope is payload-agnostic. Governance (enablement, drain under pressure) reads
/// only envelope fields and <see cref="IndexKeys"/> — never the JSON body.
/// Identity of the fact schema is <see cref="Type"/> + <see cref="SchemaVersion"/>,
/// not a CLR type name.
/// </para>
/// <para>
/// Call sites append the envelope into the Journal admission queue synchronously.
/// Durable persistence is performed later by the Journal drain according to
/// <see cref="PublishPolicy"/>. <see cref="Id"/> and <see cref="PublishedAt"/> are
/// stamped on admission; <see cref="Sequence"/> is assigned on durable write
/// (zero means not yet persisted).
/// </para>
/// </remarks>
public sealed class JournalEntry
{
    /// <summary>
    /// Public logical identity of this fact (stable across reads).
    /// </summary>
    public Guid Id { get; init; }

    /// <summary>
    /// Monotonic store sequence used for deterministic ordering and cursor reads.
    /// </summary>
    /// <remarks>
    /// Assigned on durable write by the drain. Zero means accepted but not yet persisted.
    /// </remarks>
    public long Sequence { get; init; }

    /// <summary>
    /// Stable fact schema name (for example <c>BrowserSessions.SessionStarted</c>).
    /// </summary>
    public required string Type { get; init; }

    /// <summary>
    /// Secondary index keys for relationship queries without inspecting <see cref="Payload"/>.
    /// </summary>
    /// <remarks>
    /// At most one value per key type per entry. Keys are the searchable projection of
    /// entities involved in the fact (session, profile, pipe, and so on).
    /// </remarks>
    public required IReadOnlyList<JournalIndexKey> IndexKeys { get; init; }

    /// <summary>
    /// How the Journal drain must treat this fact after enqueue (not a caller-side await contract).
    /// </summary>
    public PublishPolicy PublishPolicy { get; init; }

    /// <summary>
    /// Version of the <see cref="Type"/> payload schema. Breaking payload changes require a new version.
    /// </summary>
    public required int SchemaVersion { get; init; }

    /// <summary>
    /// UTC timestamp when the Journal accepted the fact into the admission queue.
    /// </summary>
    public DateTimeOffset PublishedAt { get; init; }

    /// <summary>
    /// Optional JSON body for this fact. Opaque to the Journal core.
    /// </summary>
    public string? Payload { get; init; }
}
