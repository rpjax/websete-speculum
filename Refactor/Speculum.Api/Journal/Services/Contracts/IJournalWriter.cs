using Speculum.Api.Journal.Models;

namespace Speculum.Api.Journal.Services.Contracts;

/// <summary>
/// Producer port: admits typed facts into the Journal admission path.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="Append{T}"/> is synchronous and deliberately cheap. It resolves the payload
/// schema from <see cref="IJournalCatalog"/>, stamps identity timestamps, extracts index keys,
/// serializes the payload, and enqueues. It never awaits durable store I/O.
/// </para>
/// <para>
/// After enqueue, the Journal drain persists according to
/// <see cref="JournalEntry.PublishPolicy"/>. Disabled types are skipped without error.
/// Unregistered types throw when <see cref="IJournalCatalog.RejectUnregisteredTypes"/> is true
/// (default); otherwise they are skipped. Missing required indexes throw.
/// </para>
/// <para>
/// Call sites pass only the payload instance — never descriptors, catalog keys, or index maps.
/// See <c>Journal/README.md</c> for the full admission matrix.
/// </para>
/// </remarks>
public interface IJournalWriter
{
    /// <summary>
    /// Accepts a typed fact into the Journal queue. Does not wait for durable persistence.
    /// </summary>
    void Append<T>(T payload);
}
