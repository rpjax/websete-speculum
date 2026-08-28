using System.Collections.Concurrent;
using System.Threading.Channels;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.Journal.Services;

/// <summary>
/// Bounded per-subscriber fan-out of admitted facts. Publishers never wait:
/// a full subscriber buffer drops its oldest fact instead of slowing admission.
/// </summary>
public sealed class JournalLiveFeed : IJournalLiveFeed
{
    /// <summary>
    /// Facts buffered per subscriber. Deep enough to absorb a drain batch burst,
    /// shallow enough that a stalled observer cannot pin memory.
    /// </summary>
    public const int SubscriberCapacity = 256;

    private readonly ConcurrentDictionary<Guid, Subscription> _subscriptions = new();

    public void Publish(JournalEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);

        foreach (var subscription in _subscriptions.Values)
        {
            subscription.Offer(entry);
        }
    }

    public IJournalLiveSubscription Subscribe()
    {
        var subscription = new Subscription(Guid.CreateVersion7(), this);
        _subscriptions[subscription.Id] = subscription;
        return subscription;
    }

    private void Remove(Guid id) => _subscriptions.TryRemove(id, out _);

    private sealed class Subscription : IJournalLiveSubscription
    {
        private readonly JournalLiveFeed _feed;
        private readonly Channel<JournalEntry> _channel;
        private int _disposed;

        public Subscription(Guid id, JournalLiveFeed feed)
        {
            Id = id;
            _feed = feed;
            _channel = Channel.CreateBounded<JournalEntry>(new BoundedChannelOptions(SubscriberCapacity)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
                SingleWriter = false,
                AllowSynchronousContinuations = false,
            });
        }

        public Guid Id { get; }

        public ChannelReader<JournalEntry> Reader => _channel.Reader;

        public void Offer(JournalEntry entry) => _channel.Writer.TryWrite(entry);

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0)
                return;

            _feed.Remove(Id);
            _channel.Writer.TryComplete();
        }
    }
}
