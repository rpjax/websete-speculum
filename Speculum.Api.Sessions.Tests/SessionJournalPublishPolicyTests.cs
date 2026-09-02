using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services;
using Speculum.Api.Profiles.Events;
using Speculum.Api.Sessions.Events.Models;
using Speculum.Api.Telemetry.Events.Models.Sampling;
using ClientAttachedCommandFailed = Speculum.Api.Telemetry.Events.Models.Sessions.Client.AttachedCommandFailed;
using BrowseLocationChanged = Speculum.Api.Telemetry.Events.Models.Sessions.Browse.LocationChanged;
using PageProjectionFrameReceived = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame.FrameReceived;
using PageProjectionFrameGenerationBumped = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame.GenerationBumped;
using PageProjectionFrameQueueDropped = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame.QueueDropped;
using PageProjectionFrameWireDelivered = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame.WireDelivered;
using PageProjectionFrameFanOutEnqueued = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame.FanOutEnqueued;
using PageProjectionFrameStreamDequeued = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame.StreamDequeued;
using PageProjectionFrameOutputStreamOpened = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame.OutputStreamOpened;
using PageProjectionFrameOutputStreamClosed = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame.OutputStreamClosed;
using PageProjectionFrameResyncRequested = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame.ResyncRequested;
using PageProjectionFrameResyncServed = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame.ResyncServed;
using DomInputAdmissionDropped = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input.AdmissionDropped;
using DomInputApplied = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input.Applied;
using DomInputCdpDropped = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input.CdpDropped;
using DomInputDataPlaneReceived = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input.DataPlaneReceived;
using DomInputRejected = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input.Rejected;
using DomInputSidecarEnqueued = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input.SidecarEnqueued;
using DomInputSidecarPushWritten = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input.SidecarPushWritten;
using ResizeApplied = Speculum.Api.Telemetry.Events.Models.Sessions.Resize.Applied;
using ResizeRejected = Speculum.Api.Telemetry.Events.Models.Sessions.Resize.Rejected;
using VsiApplied = Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput.Applied;
using VsiControlReceived = Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput.ControlReceived;
using VsiDataPlaneReceived = Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput.DataPlaneReceived;
using VsiRejected = Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput.Rejected;
using VsiSidecarEnqueued = Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput.SidecarEnqueued;
using VsiSidecarPushWritten = Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput.SidecarPushWritten;

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
        catalog.RegisterFromAssemblies(typeof(SampleCollected).Assembly);

        Assert.True(catalog.TryGet<SessionStarted>(out _));
        Assert.True(catalog.TryGet<ProfileEnsureExisting>(out _));

        var soft = catalog.Types
            .Where(d => d.Type.StartsWith("Sessions.", StringComparison.Ordinal)
                || d.Type.StartsWith("Profiles.", StringComparison.Ordinal))
            .Where(d => d.PublishPolicy != PublishPolicy.Guaranteed)
            .Select(d => $"{d.Type}@v{d.SchemaVersion}")
            .OrderBy(x => x, StringComparer.Ordinal)
            .ToArray();

        Assert.True(
            soft.Length == 0,
            "Expected Guaranteed lifecycle facts, still BestEffort: " + string.Join(", ", soft));

        Assert.True(catalog.TryGet<ClientAttachedCommandFailed>(out var commandFailed));
        Assert.Equal(PublishPolicy.BestEffort, commandFailed.PublishPolicy);
        Assert.True(catalog.TryGet<BrowseLocationChanged>(out var locationChanged));
        Assert.Equal(PublishPolicy.BestEffort, locationChanged.PublishPolicy);

        Assert.True(catalog.TryGet<VsiRejected>(out var vsiRejected));
        Assert.Equal(PublishPolicy.BestEffort, vsiRejected.PublishPolicy);
        Assert.False(vsiRejected.IsCanonical);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.VideoStreamingInput.Rejected"));
        Assert.True(catalog.TryGet<VsiApplied>(out var vsiApplied));
        Assert.Equal(PublishPolicy.BestEffort, vsiApplied.PublishPolicy);
        Assert.False(vsiApplied.IsCanonical);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.VideoStreamingInput.Applied"));
        Assert.True(catalog.TryGet<VsiDataPlaneReceived>(out var dataPlaneReceived));
        Assert.Equal(PublishPolicy.BestEffort, dataPlaneReceived.PublishPolicy);
        Assert.Equal(2, dataPlaneReceived.SchemaVersion);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.VideoStreamingInput.DataPlaneReceived"));
        Assert.True(catalog.TryGet<VsiControlReceived>(out var controlReceived));
        Assert.Equal(PublishPolicy.BestEffort, controlReceived.PublishPolicy);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.VideoStreamingInput.ControlReceived"));
        Assert.True(catalog.TryGet<VsiSidecarPushWritten>(out var grpcPushed));
        Assert.Equal(PublishPolicy.BestEffort, grpcPushed.PublishPolicy);
        Assert.Equal(2, grpcPushed.SchemaVersion);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.VideoStreamingInput.SidecarPushWritten"));
        Assert.True(catalog.TryGet<VsiSidecarEnqueued>(out var sidecarEnqueued));
        Assert.Equal(PublishPolicy.BestEffort, sidecarEnqueued.PublishPolicy);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.VideoStreamingInput.SidecarEnqueued"));

        Assert.True(catalog.TryGet<PageProjectionFrameReceived>(out var domDiff));
        Assert.Equal(PublishPolicy.BestEffort, domDiff.PublishPolicy);
        Assert.Equal(5, domDiff.SchemaVersion);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Frame.FrameReceived"));
        Assert.True(catalog.TryGet<PageProjectionFrameGenerationBumped>(out var domGenBumped));
        Assert.Equal(PublishPolicy.BestEffort, domGenBumped.PublishPolicy);
        Assert.Equal(1, domGenBumped.SchemaVersion);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Frame.GenerationBumped"));
        Assert.True(catalog.TryGet<PageProjectionFrameQueueDropped>(out var queueDropped));
        Assert.Equal(PublishPolicy.BestEffort, queueDropped.PublishPolicy);
        Assert.Equal(3, queueDropped.SchemaVersion);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Frame.QueueDropped"));
        Assert.True(catalog.TryGet<PageProjectionFrameOutputStreamOpened>(out var outputStreamOpened));
        Assert.Equal(PublishPolicy.BestEffort, outputStreamOpened.PublishPolicy);
        Assert.Equal(1, outputStreamOpened.SchemaVersion);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Frame.OutputStreamOpened"));
        Assert.True(catalog.TryGet<PageProjectionFrameOutputStreamClosed>(out var outputStreamClosed));
        Assert.Equal(PublishPolicy.BestEffort, outputStreamClosed.PublishPolicy);
        Assert.Equal(1, outputStreamClosed.SchemaVersion);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Frame.OutputStreamClosed"));
        Assert.True(catalog.TryGet<PageProjectionFrameFanOutEnqueued>(out var fanOutEnqueued));
        Assert.Equal(PublishPolicy.BestEffort, fanOutEnqueued.PublishPolicy);
        Assert.Equal(3, fanOutEnqueued.SchemaVersion);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Frame.FanOutEnqueued"));
        Assert.True(catalog.TryGet<PageProjectionFrameStreamDequeued>(out var streamDequeued));
        Assert.Equal(PublishPolicy.BestEffort, streamDequeued.PublishPolicy);
        Assert.Equal(3, streamDequeued.SchemaVersion);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Frame.StreamDequeued"));
        Assert.True(catalog.TryGet<PageProjectionFrameWireDelivered>(out var wireDelivered));
        Assert.Equal(PublishPolicy.BestEffort, wireDelivered.PublishPolicy);
        Assert.Equal(4, wireDelivered.SchemaVersion);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Frame.WireDelivered"));
        Assert.True(catalog.TryGet<PageProjectionFrameResyncRequested>(out var resyncRequested));
        Assert.Equal(PublishPolicy.BestEffort, resyncRequested.PublishPolicy);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Frame.ResyncRequested"));
        Assert.True(catalog.TryGet<PageProjectionFrameResyncServed>(out var resyncServed));
        Assert.Equal(PublishPolicy.BestEffort, resyncServed.PublishPolicy);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Frame.ResyncServed"));
        Assert.True(catalog.TryGet<DomInputDataPlaneReceived>(out var domInputDataPlane));
        Assert.Equal(PublishPolicy.BestEffort, domInputDataPlane.PublishPolicy);
        Assert.Equal(2, domInputDataPlane.SchemaVersion);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Input.DataPlaneReceived"));
        Assert.True(catalog.TryGet<DomInputSidecarPushWritten>(out var domInputPush));
        Assert.Equal(PublishPolicy.BestEffort, domInputPush.PublishPolicy);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Input.SidecarPushWritten"));
        Assert.True(catalog.TryGet<DomInputAdmissionDropped>(out var domAdmissionDropped));
        Assert.Equal(PublishPolicy.BestEffort, domAdmissionDropped.PublishPolicy);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Input.AdmissionDropped"));
        Assert.True(catalog.TryGet<DomInputSidecarEnqueued>(out var domSidecarEnqueued));
        Assert.Equal(PublishPolicy.BestEffort, domSidecarEnqueued.PublishPolicy);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Input.SidecarEnqueued"));
        Assert.True(catalog.TryGet<DomInputCdpDropped>(out var domCdpDropped));
        Assert.Equal(PublishPolicy.BestEffort, domCdpDropped.PublishPolicy);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Input.CdpDropped"));
        Assert.True(catalog.TryGet<DomInputApplied>(out var domInputApplied));
        Assert.Equal(PublishPolicy.BestEffort, domInputApplied.PublishPolicy);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Input.Applied"));
        Assert.True(catalog.TryGet<DomInputRejected>(out var domInputRejected));
        Assert.Equal(PublishPolicy.BestEffort, domInputRejected.PublishPolicy);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.PageProjection.Input.Rejected"));

        Assert.True(catalog.TryGet<ResizeApplied>(out var resizeApplied));
        Assert.Equal(PublishPolicy.BestEffort, resizeApplied.PublishPolicy);
        Assert.False(resizeApplied.IsCanonical);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.Resize.Applied"));
        Assert.True(catalog.TryGet<ResizeRejected>(out var resizeRejected));
        Assert.Equal(PublishPolicy.BestEffort, resizeRejected.PublishPolicy);
        Assert.False(resizeRejected.IsCanonical);
        Assert.False(catalog.IsTypeEnabled("Telemetry.Sessions.Resize.Rejected"));
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
