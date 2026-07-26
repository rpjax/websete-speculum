using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services;
using Speculum.Api.Sessions.Events.Models;

namespace Speculum.Api.Journal.Tests;

public sealed class JournalLiveFeedTests
{
    [Fact]
    public async Task Append_PublishesAdmittedFactToSubscribers()
    {
        var feed = new JournalLiveFeed();
        using var first = feed.Subscribe();
        using var second = feed.Subscribe();
        var writer = CreateWriter(feed, out var queue, enabled: true);

        var profileId = Guid.CreateVersion7();
        var sessionId = Guid.CreateVersion7();
        writer.Append(new SessionStarted
        {
            ProfileId = profileId,
            SessionId = sessionId,
        });

        Assert.Equal(1, queue.Count);

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        foreach (var subscription in new[] { first, second })
        {
            var fact = await subscription.Reader.ReadAsync(timeout.Token);
            Assert.Equal("Sessions.SessionStarted", fact.Type);
            Assert.Equal(PublishPolicy.Guaranteed, fact.PublishPolicy);
            Assert.Contains(fact.IndexKeys, k => k.Type == "session" && k.Value == sessionId.ToString("D"));
            Assert.False(string.IsNullOrWhiteSpace(fact.Payload));
        }
    }

    [Fact]
    public void Append_DisabledType_PublishesNothing()
    {
        var feed = new JournalLiveFeed();
        using var subscription = feed.Subscribe();
        var writer = CreateWriter(feed, out var queue, enabled: false);

        writer.Append(new SessionStarted
        {
            ProfileId = Guid.CreateVersion7(),
            SessionId = Guid.CreateVersion7(),
        });

        Assert.Equal(0, queue.Count);
        Assert.False(subscription.Reader.TryRead(out _));
    }

    [Fact]
    public void Publish_BeyondCapacity_KeepsNewestFacts()
    {
        var feed = new JournalLiveFeed();
        using var subscription = feed.Subscribe();

        var overflow = JournalLiveFeed.SubscriberCapacity + 5;
        for (var index = 0; index < overflow; index++)
        {
            feed.Publish(JournalTestHarness.Entry(type: $"Test.Fact{index}"));
        }

        var received = new List<string>();
        while (subscription.Reader.TryRead(out var entry))
        {
            received.Add(entry.Type);
        }

        Assert.Equal(JournalLiveFeed.SubscriberCapacity, received.Count);
        Assert.Equal($"Test.Fact{overflow - 1}", received[^1]);
        Assert.DoesNotContain("Test.Fact0", received);
    }

    [Fact]
    public void Publish_AfterDispose_DoesNotReachSubscriber()
    {
        var feed = new JournalLiveFeed();
        var subscription = feed.Subscribe();
        subscription.Dispose();

        feed.Publish(JournalTestHarness.Entry());

        Assert.False(subscription.Reader.TryRead(out _));
    }

    private static JournalWriter CreateWriter(
        JournalLiveFeed feed,
        out JournalQueue queue,
        bool enabled)
    {
        var catalog = new JournalCatalog();
        catalog.RegisterFromAssemblies(typeof(SessionStarted).Assembly);
        if (!enabled)
        {
            catalog.SetEnabled("Sessions.SessionStarted", false);
        }

        var (created, metrics, health) = JournalTestHarness.CreateQueue(o => o.MaxQueueDepth = 0);
        queue = created;

        return new JournalWriter(
            catalog,
            queue,
            health,
            metrics,
            feed,
            new StaticOptionsMonitor<JournalDrainOptions>(new JournalDrainOptions()),
            NullLogger<JournalWriter>.Instance);
    }
}
