using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services;
using Speculum.Api.Sessions.Events.Models;

namespace Speculum.Api.Journal.Tests;

public sealed class JournalWriterTests
{
    [Fact]
    public async Task Append_SessionStarted_StampsEnvelopeAndIndexes()
    {
        var catalog = new JournalCatalog();
        catalog.RegisterFromAssemblies(typeof(SessionStarted).Assembly);

        var (queue, metrics, health) = JournalTestHarness.CreateQueue(o =>
        {
            o.SoftQueueDepth = 0;
            o.HardQueueDepth = 0;
            o.MaxQueueDepth = 0;
        });

        var monitor = new StaticOptionsMonitor<JournalDrainOptions>(new JournalDrainOptions
        {
            MaxPayloadBytes = 64 * 1024,
        });

        var writer = new JournalWriter(
            catalog,
            queue,
            health,
            metrics,
            monitor,
            NullLogger<JournalWriter>.Instance);

        var profileId = Guid.CreateVersion7();
        var sessionId = Guid.CreateVersion7();
        writer.Append(new SessionStarted
        {
            ProfileId = profileId,
            SessionId = sessionId,
        });

        Assert.Equal(1, queue.Count);
        var entry = (await queue.TakeBatchAsync(1)).Single();
        Assert.Equal("Sessions.SessionStarted", entry.Type);
        Assert.Equal(PublishPolicy.Guaranteed, entry.PublishPolicy);
        Assert.NotEqual(Guid.Empty, entry.Id);
        Assert.NotEqual(default, entry.PublishedAt);
        Assert.Contains(entry.IndexKeys, k => k.Type == "profile" && k.Value == profileId.ToString("D"));
        Assert.Contains(entry.IndexKeys, k => k.Type == "session" && k.Value == sessionId.ToString("D"));
        Assert.False(string.IsNullOrWhiteSpace(entry.Payload));
    }

    [Fact]
    public void Append_DisabledType_Skips()
    {
        var catalog = new JournalCatalog();
        catalog.RegisterFromAssemblies(typeof(SessionStarted).Assembly);
        catalog.SetEnabled("Sessions.SessionStarted", false);

        var (queue, metrics, health) = JournalTestHarness.CreateQueue(o => o.MaxQueueDepth = 0);
        var writer = new JournalWriter(
            catalog,
            queue,
            health,
            metrics,
            new StaticOptionsMonitor<JournalDrainOptions>(new JournalDrainOptions()),
            NullLogger<JournalWriter>.Instance);

        writer.Append(new SessionStarted
        {
            ProfileId = Guid.CreateVersion7(),
            SessionId = Guid.CreateVersion7(),
        });

        Assert.Equal(0, queue.Count);
        Assert.Equal(1, metrics.SkippedDisabled);
    }

    [Fact]
    public void Append_WhenAdmissionClosed_RejectsGuaranteed()
    {
        var catalog = new JournalCatalog();
        catalog.RegisterFromAssemblies(typeof(SessionStarted).Assembly);

        var (queue, metrics, health) = JournalTestHarness.CreateQueue(o => o.MaxQueueDepth = 0);
        health.SetDrainRunning(true);
        health.SetDrainRunning(false);

        var writer = new JournalWriter(
            catalog,
            queue,
            health,
            metrics,
            new StaticOptionsMonitor<JournalDrainOptions>(new JournalDrainOptions()),
            NullLogger<JournalWriter>.Instance);

        writer.Append(new SessionStarted
        {
            ProfileId = Guid.CreateVersion7(),
            SessionId = Guid.CreateVersion7(),
        });

        Assert.Equal(0, queue.Count);
        Assert.Equal(1, metrics.GuaranteedAdmissionFailures);
        Assert.True(health.IsPersistDegraded);
    }
}
