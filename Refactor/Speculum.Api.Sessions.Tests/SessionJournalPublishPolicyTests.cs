using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services;
using Speculum.Api.Profiles.Events;
using Speculum.Api.Sessions.Events.Models;

namespace Speculum.Api.Sessions.Tests;

/// <summary>
/// Session start/stop narrative facts must survive drain pressure (Act→Assert).
/// </summary>
public sealed class SessionJournalPublishPolicyTests
{
    [Fact]
    public void SessionAndProfileLifecycleFacts_AreGuaranteed()
    {
        var catalog = new JournalCatalog();
        catalog.RegisterFromAssemblies(typeof(SessionStarted).Assembly);

        Assert.True(catalog.TryGet<SessionStarted>(out _));
        Assert.True(catalog.TryGet<ProfileReused>(out _));

        var soft = catalog.Types
            .Where(d => d.Type.StartsWith("Sessions.", StringComparison.Ordinal)
                || d.Type.StartsWith("Profiles.", StringComparison.Ordinal))
            // Live attached-client push failures are BestEffort (transient SignalR flaps).
            .Where(d => d.Type is not "Sessions.AttachedClientCommandFailed")
            .Where(d => d.PublishPolicy != PublishPolicy.Guaranteed)
            .Select(d => $"{d.Type}@v{d.SchemaVersion}")
            .OrderBy(x => x, StringComparer.Ordinal)
            .ToArray();

        Assert.True(
            soft.Length == 0,
            "Expected Guaranteed lifecycle facts, still BestEffort: " + string.Join(", ", soft));

        Assert.True(catalog.TryGet<AttachedClientCommandFailed>(out var commandFailed));
        Assert.Equal(PublishPolicy.BestEffort, commandFailed.PublishPolicy);
        Assert.True(catalog.TryGet<FeatureLoopFaulted>(out var loopFaulted));
        Assert.Equal(PublishPolicy.Guaranteed, loopFaulted.PublishPolicy);
    }
}
