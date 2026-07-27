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
            // Live attached-client push failures and high-churn browser observations are BestEffort.
            .Where(d => d.Type is not "Sessions.AttachedClientCommandFailed"
                and not "Sessions.LocationChanged"
                and not "Sessions.InputRejected"
                and not "Sessions.InputApplied"
                and not "Sessions.ResizeApplied"
                and not "Sessions.ResizeRejected")
            .Where(d => d.PublishPolicy != PublishPolicy.Guaranteed)
            .Select(d => $"{d.Type}@v{d.SchemaVersion}")
            .OrderBy(x => x, StringComparer.Ordinal)
            .ToArray();

        Assert.True(
            soft.Length == 0,
            "Expected Guaranteed lifecycle facts, still BestEffort: " + string.Join(", ", soft));

        Assert.True(catalog.TryGet<AttachedClientCommandFailed>(out var commandFailed));
        Assert.Equal(PublishPolicy.BestEffort, commandFailed.PublishPolicy);
        Assert.True(catalog.TryGet<LocationChanged>(out var locationChanged));
        Assert.Equal(PublishPolicy.BestEffort, locationChanged.PublishPolicy);
        Assert.True(catalog.TryGet<InputRejected>(out var inputRejected));
        Assert.Equal(PublishPolicy.BestEffort, inputRejected.PublishPolicy);
        Assert.False(inputRejected.IsCanonical);
        Assert.False(catalog.IsTypeEnabled("Sessions.InputRejected"));
        Assert.True(catalog.TryGet<InputApplied>(out var inputApplied));
        Assert.Equal(PublishPolicy.BestEffort, inputApplied.PublishPolicy);
        Assert.False(inputApplied.IsCanonical);
        Assert.False(catalog.IsTypeEnabled("Sessions.InputApplied"));
        Assert.True(catalog.TryGet<ResizeApplied>(out var resizeApplied));
        Assert.Equal(PublishPolicy.BestEffort, resizeApplied.PublishPolicy);
        Assert.False(resizeApplied.IsCanonical);
        Assert.False(catalog.IsTypeEnabled("Sessions.ResizeApplied"));
        Assert.True(catalog.TryGet<ResizeRejected>(out var resizeRejected));
        Assert.Equal(PublishPolicy.BestEffort, resizeRejected.PublishPolicy);
        Assert.False(resizeRejected.IsCanonical);
        Assert.False(catalog.IsTypeEnabled("Sessions.ResizeRejected"));
        Assert.True(catalog.TryGet<SessionStarted>(out var sessionStarted));
        Assert.True(sessionStarted.IsCanonical);
        Assert.True(catalog.IsTypeEnabled("Sessions.SessionStarted"));
        Assert.True(catalog.TryGet<FeatureLoopFaulted>(out var loopFaulted));
        Assert.Equal(PublishPolicy.Guaranteed, loopFaulted.PublishPolicy);
        Assert.True(loopFaulted.IsCanonical);
        Assert.True(catalog.TryGet<NavigateRequested>(out var navigateRequested));
        Assert.Equal(PublishPolicy.Guaranteed, navigateRequested.PublishPolicy);
        Assert.True(catalog.TryGet<NavigateFailed>(out var navigateFailed));
        Assert.Equal(PublishPolicy.Guaranteed, navigateFailed.PublishPolicy);
        Assert.True(catalog.TryGet<MainFrameNavigationBlocked>(out var blocked));
        Assert.Equal(PublishPolicy.Guaranteed, blocked.PublishPolicy);
        Assert.True(catalog.TryGet<BrowserCrashed>(out var crashed));
        Assert.Equal(PublishPolicy.Guaranteed, crashed.PublishPolicy);
        Assert.True(catalog.TryGet<LiveSessionAbandoned>(out var abandoned));
        Assert.Equal(PublishPolicy.Guaranteed, abandoned.PublishPolicy);
    }
}
