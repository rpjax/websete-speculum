using System.Threading.Channels;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Journal.Services.Contracts;

/// <summary>
/// In-process fan-out of facts the Journal has admitted, for live observation.
/// </summary>
/// <remarks>
/// <para>
/// This is an observation tap, not a read model and not a delivery guarantee:
/// durable truth stays with <see cref="IJournalReader"/>. A subscriber that cannot
/// keep up loses its oldest facts; nothing on the admission path ever blocks or fails
/// because of a live subscriber.
/// </para>
/// <para>
/// The feed is payload- and domain-agnostic: it carries whatever the catalog admitted,
/// so enablement stays a catalog concern (<see cref="IJournalCatalog"/>).
/// </para>
/// </remarks>
public interface IJournalLiveFeed
{
    /// <summary>
    /// Offers one admitted fact to every current subscriber. Never blocks, never throws
    /// because of subscriber state.
    /// </summary>
    void Publish(JournalEntry entry);

    /// <summary>
    /// Starts observing admitted facts. Dispose to unsubscribe and release the buffer.
    /// </summary>
    IJournalLiveSubscription Subscribe();
}

/// <summary>
/// One live reader of admitted Journal facts.
/// </summary>
public interface IJournalLiveSubscription : IDisposable
{
    ChannelReader<JournalEntry> Reader { get; }
}
