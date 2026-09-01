using System.Threading.Channels;
using Aidan.Core.Patterns;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Models.Patterns;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Mirror;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Sessions.Services.Streaming;
using Speculum.Api.Telemetry.Events.Services.Contracts;

namespace Speculum.Api.Sessions.Tests;

public sealed class LiveSessionTests
{
    private static Guid AttachAndObserve(ILiveSession live, IAttachedSessionClient client)
    {
        var attachmentId = live.Attach(client).Value;
        var notifications = live.OpenNotificationStream(attachmentId).Value;
        Assert.True(live.ObserveSessionNotifications(notifications).IsSuccess);
        return attachmentId;
    }
    [Fact]
    public async Task Create_OneContextPerSession_SecondCreateFails()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var service = CreateService();

        var created = service.Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true);
        var again = service.Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true);

        Assert.True(created.IsSuccess);
        Assert.True(again.IsFailure);
        Assert.True(service.TryGet(sessionId, out var found));
        Assert.Same(created.Value, found);
        Assert.NotNull(connection.CameraHandler);
    }

    [Fact]
    public async Task TryGet_WithoutCreate_ReturnsFalse()
    {
        var sessionId = Guid.NewGuid();
        var service = CreateService();

        Assert.False(service.TryGet(sessionId, out _));
    }

    [Fact]
    public async Task OpenFrameStream_BroadcastsToAllConsumers()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var a = live.OpenFrameStream(Guid.NewGuid()).Value;
        var b = live.OpenFrameStream(Guid.NewGuid()).Value;

        await connection.Frames.Writer.WriteAsync(new Frame { Sequence = 7 });
        Assert.Equal(7, (await a.GetFramesChannel().Value.ReadAsync()).Sequence);
        Assert.Equal(7, (await b.GetFramesChannel().Value.ReadAsync()).Sequence);
    }

    [Fact]
    public async Task AttachThenFrameStream_DefaultPolicy_DeliversFramesToFramePipe()
    {
        // Regression: Exclusive default used to pin output to the Attach notification pipe,
        // starving the later WebTransport frame pipe.
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var attachmentId = AttachAndObserve(live, new RecordingAttachedClient());
        var frames = live.OpenFrameStream(attachmentId).Value;

        await connection.Frames.Writer.WriteAsync(new Frame { Sequence = 42 });
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        var frame = await frames.GetFramesChannel().Value.ReadAsync(cts.Token);
        Assert.Equal(42, frame.Sequence);
    }

    [Fact]
    public async Task ExclusiveOutput_DeliversFramesOnlyToFirstPipe()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService(configuration: SessionsTestHarness.Configuration(new SessionsConfiguration
        {
            IsJsBridgeEnabled = true,
            DetachedSessionTimeout = TimeSpan.FromMinutes(5),
            MirrorMode = MirrorMode.VideoStreaming,
            InputMultiplexingPolicy = new InputMultiplexingPolicy { Access = InputAccessPolicy.Shared },
            OutputMultiplexingPolicy = new OutputMultiplexingPolicy
            {
                Delivery = OutputDeliveryPolicy.Exclusive,
            },
        })).Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var first = live.OpenFrameStream(Guid.NewGuid()).Value;
        var second = live.OpenFrameStream(Guid.NewGuid()).Value;

        await connection.Frames.Writer.WriteAsync(new Frame { Sequence = 9 });

        using var firstCts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        Assert.Equal(9, (await first.GetFramesChannel().Value.ReadAsync(firstCts.Token)).Sequence);

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
            await second.GetFramesChannel().Value.ReadAsync(cts.Token));
    }

    [Fact]
    public async Task DisposeFrameStream_SiblingStillReceives()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var a = live.OpenFrameStream(Guid.NewGuid()).Value;
        var b = live.OpenFrameStream(Guid.NewGuid()).Value;
        a.Dispose();
        Assert.True(a.GetFramesChannel().IsFailure);

        await connection.Frames.Writer.WriteAsync(new Frame { Sequence = 1 });
        Assert.Equal(1, (await b.GetFramesChannel().Value.ReadAsync()).Sequence);
    }

    [Fact]
    public async Task OpenFrameStream_AfterAllDisposed_StillWorks()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var first = live.OpenFrameStream(Guid.NewGuid()).Value;
        first.Dispose();

        var second = live.OpenFrameStream(Guid.NewGuid()).Value;
        await connection.Frames.Writer.WriteAsync(new Frame { Sequence = 99 });
        Assert.Equal(99, (await second.GetFramesChannel().Value.ReadAsync()).Sequence);
    }

    [Fact]
    public void MirrorMode_VideoStreaming_GatesDomContracts()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        Assert.Equal(MirrorMode.VideoStreaming, live.MirrorMode);
        Assert.True(live.OpenFrameStream(Guid.NewGuid()).IsSuccess);
        Assert.True(live.OpenPageProjectionFramesStream(Guid.NewGuid()).IsFailure);
        Assert.Contains(
            SessionMirrorErrors.PageProjectionRequiredMessage,
            live.OpenPageProjectionFramesStream(Guid.NewGuid()).Errors.Select(e => e.Message));
        Assert.True(live.Attach(new RecordingAttachedClient()).IsSuccess);
        Assert.True(live.AdmitVideoStreamingInput(new VideoStreamingInput
        {
            Type = "mousemove",
            Payload = """{"type":"mousemove","x":1,"y":2}""",
        }).IsSuccess);
        Assert.True(live.AdmitPageProjectionInput(new PageProjectionIntent
        {
            Type = "click",
            Payload = "{}",
        }).IsFailure);
        Assert.Contains(
            SessionMirrorErrors.PageProjectionRequiredMessage,
            live.AdmitPageProjectionInput(new PageProjectionIntent
            {
                Type = "click",
                Payload = "{}",
            }).Errors.Select(e => e.Message));
    }

    [Fact]
    public async Task MirrorMode_PageProjection_GatesVideoAndOpensDomStream()
    {
        var baseline = SessionsTestHarness.Sessions();
        var sessions = new SessionsConfiguration
        {
            DetachedSessionTimeout = baseline.DetachedSessionTimeout,
            IsJsBridgeEnabled = baseline.IsJsBridgeEnabled,
            DataStreamTransport = baseline.DataStreamTransport,
            MirrorMode = MirrorMode.PageProjection,
            ViewportPolicy = baseline.ViewportPolicy,
            ClientEnvironmentPolicy = baseline.ClientEnvironmentPolicy,
            DeviceEmulationPolicy = baseline.DeviceEmulationPolicy,
            ScreencastPolicy = baseline.ScreencastPolicy,
            InputMultiplexingPolicy = baseline.InputMultiplexingPolicy,
            OutputMultiplexingPolicy = baseline.OutputMultiplexingPolicy,
        };
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService(configuration: SessionsTestHarness.Configuration(sessions))
            .Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true)
            .Value;

        Assert.Equal(MirrorMode.PageProjection, live.MirrorMode);
        Assert.True(live.OpenFrameStream(Guid.NewGuid()).IsFailure);
        Assert.Contains(
            SessionMirrorErrors.VideoStreamingRequiredMessage,
            live.OpenFrameStream(Guid.NewGuid()).Errors.Select(e => e.Message));
        Assert.True(live.AdmitVideoStreamingInput(new VideoStreamingInput
        {
            Type = "mousemove",
            Payload = """{"type":"mousemove","x":1,"y":2}""",
        }).IsFailure);

        var openDom = live.OpenPageProjectionFramesStream(Guid.NewGuid());
        Assert.True(openDom.IsSuccess);

        var admitDom = live.AdmitPageProjectionInput(new PageProjectionIntent
        {
            Type = "mousedown",
            Anchor = "a1",
            Generation = 1,
            Payload = """{"x":1,"y":2,"button":0}""",
        });
        Assert.True(admitDom.IsSuccess);

        // Effect: opaque frame body + contextId on Frames stream (gate 10 surface smoke).
        var body = new byte[] { 0x50, 0x50, 0x00, 0x01, 0x02 };
        Assert.True(connection.PageProjectionFrames.Writer.TryWrite(new PageProjectionFrame
        {
            Sequence = 1,
            Generation = 1,
            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Plane = "",
            Operation = "",
            Body = body,
            PartIndex = 0,
            PartCount = 1,
            Flags = 1,
            Version = 1,
            ContextId = 1,
        }));
        using var frameCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var diffs = openDom.Value!.GetPageProjectionFramesChannel();
        Assert.True(diffs.IsSuccess);
        var frame = await diffs.Value.ReadAsync(frameCts.Token);
        Assert.Equal(1, frame.Sequence);
        Assert.Equal(1u, frame.ContextId);
        Assert.Equal(body, frame.Body);

        var resync = await live.RequestResyncAsync(1, "gate10_surface", CancellationToken.None);
        Assert.True(resync.IsSuccess);
        Assert.Equal(1, connection.RequestResyncCallCount);
        Assert.Equal(1u, connection.LastResyncContextId);
        Assert.Equal("gate10_surface", connection.LastResyncReason);

        connection.VirtualAsset = new VirtualResourceResponse { Body = [1, 2, 3], ContentType = "text/css" };
        var assetOk = await live.GetVirtualAssetAsync("deadbeef");
        Assert.True(assetOk.IsSuccess);
        Assert.Equal("text/css", assetOk.Value.ContentType);
        Assert.Equal(new byte[] { 1, 2, 3 }, assetOk.Value.Body);

        var videoSessionId = Guid.NewGuid();
        var videoCreated = CreateService(
                configuration: SessionsTestHarness.Configuration(new SessionsConfiguration
                {
                    IsJsBridgeEnabled = true,
                    DetachedSessionTimeout = TimeSpan.FromMinutes(5),
                    MirrorMode = MirrorMode.VideoStreaming,
                }))
            .Create(videoSessionId, Guid.NewGuid(), new LiveFakeConnection(videoSessionId), "speculum.test", true);
        Assert.True(videoCreated.IsSuccess);
        var videoAsset = await videoCreated.Value.GetVirtualAssetAsync("abc");
        Assert.True(videoAsset.IsFailure);
        Assert.Contains(
            SessionMirrorErrors.PageProjectionRequiredMessage,
            videoAsset.Errors.Select(e => e.Message));
    }

    [Fact]
    public async Task AdmitPageProjectionInput_ForwardsWithoutCoalescing()
    {
        var (_, live, connection) = CreatePageProjectionSession();
        Assert.True(live.Attach(new RecordingAttachedClient()).IsSuccess);

        Assert.True(live.AdmitPageProjectionInput(new PageProjectionIntent
        {
            Type = "scrollViewport",
            Generation = 1,
            Payload = """{"scrollTop":1}""",
        }).IsSuccess);
        Assert.True(live.AdmitPageProjectionInput(new PageProjectionIntent
        {
            Type = "scrollViewport",
            Generation = 1,
            Payload = """{"scrollTop":2}""",
        }).IsSuccess);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var received = new List<PageProjectionIntent>();
        while (received.Count < 2)
        {
            received.Add(await connection.PageProjectionIntentReceived.Reader.ReadAsync(cts.Token));
        }

        Assert.Equal(2, received.Count);
        Assert.All(received, i => Assert.Equal("scrollViewport", i.Type));
    }

    private static (LiveSessionService Service, ILiveSession Live, LiveFakeConnection Connection) CreatePageProjectionSession()
    {
        var baseline = SessionsTestHarness.Sessions();
        var sessions = new SessionsConfiguration
        {
            DetachedSessionTimeout = baseline.DetachedSessionTimeout,
            IsJsBridgeEnabled = baseline.IsJsBridgeEnabled,
            DataStreamTransport = baseline.DataStreamTransport,
            MirrorMode = MirrorMode.PageProjection,
            ViewportPolicy = baseline.ViewportPolicy,
            ClientEnvironmentPolicy = baseline.ClientEnvironmentPolicy,
            DeviceEmulationPolicy = baseline.DeviceEmulationPolicy,
            ScreencastPolicy = baseline.ScreencastPolicy,
            InputMultiplexingPolicy = baseline.InputMultiplexingPolicy,
            OutputMultiplexingPolicy = baseline.OutputMultiplexingPolicy,
        };
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var service = CreateService(configuration: SessionsTestHarness.Configuration(sessions));
        var live = service.Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;
        return (service, live, connection);
    }

    [Fact]
    public async Task GetVirtualAssetAsync_RelaysToSessionConnection()
    {
        var (_, live, connection) = CreatePageProjectionSession();
        connection.VirtualAsset = new VirtualResourceResponse
        {
            Body = [1, 2, 3],
            ContentType = "text/css",
            StatusCode = 200,
        };

        var first = await live.GetVirtualAssetAsync("cdn.test/app.css");
        Assert.True(first.IsSuccess);
        Assert.Equal(1, connection.GetVirtualAssetCallCount);

        connection.VirtualAsset = null;
        var second = await live.GetVirtualAssetAsync("cdn.test/app.css");
        Assert.False(second.IsSuccess);
        Assert.Equal(2, connection.GetVirtualAssetCallCount);
    }

    [Fact]
    public async Task Attach_SingleClient_SecondAttachFails()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var collector = new RecordingCollector();
        var service = CreateService(
            SessionsTestHarness.Configuration(new SessionsConfiguration
            {
                IsJsBridgeEnabled = true,
                DetachedSessionTimeout = TimeSpan.FromMinutes(5),
                MirrorMode = MirrorMode.VideoStreaming,
            }),
            collector);
        var live = service.Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var stream = live.OpenFrameStream(Guid.NewGuid()).Value;
        stream.Dispose();
        Assert.Equal(0, collector.AddRefs);
        Assert.Equal(0, collector.Releases);

        var first = live.Attach(new RecordingAttachedClient()).Value;
        Assert.Equal(1, collector.AddRefs);
        Assert.True(live.Attach(new RecordingAttachedClient()).IsFailure);

        Assert.True(live.Detach(first).IsSuccess);
        Assert.True(live.Detach(first).IsFailure);
        Assert.Equal(1, collector.Releases);

        service.Release(sessionId);
        Assert.Equal(1, collector.Releases);
        Assert.True(live.Detach(first).IsSuccess);
    }

    [Fact]
    public async Task FeatureLoop_LocationChangedBufferedBeforeAttach_CallsSyncUrl()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.LocationChanged,
            Url = "https://speculum.test/before-attach",
        });

        var client = new RecordingAttachedClient();
        _ = AttachAndObserve(live, client);

        var url = await client.WaitSyncUrlAsync(TimeSpan.FromSeconds(2));
        Assert.Equal("https://speculum.test/before-attach", url);
    }

    [Fact]
    public async Task FeatureLoop_LocationChanged_CallsSyncUrl()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;
        var client = new RecordingAttachedClient();
        _ = AttachAndObserve(live, client);

        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.LocationChanged,
            Url = "https://speculum.test/synced",
        });

        var url = await client.WaitSyncUrlAsync(TimeSpan.FromSeconds(2));
        Assert.Equal("https://speculum.test/synced", url);
    }

    [Fact]
    public async Task FeatureLoop_LocationChanged_PassesThroughSidecarProjectedUrl()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService()
            .Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true)
            .Value;
        var client = new RecordingAttachedClient();
        _ = AttachAndObserve(live, client);

        const string projected =
            "https://speculum.test/listing?q=1&_w7s_nso=eyJ2IjoxLCJoIjoiY2FycyJ9";

        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.LocationChanged,
            Url = projected,
        });

        var synced = await client.WaitSyncUrlAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(projected, synced);
    }

    [Fact]
    public async Task FeatureLoop_MainFrameBlocked_CallsRedirect()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;
        var client = new RecordingAttachedClient();
        _ = AttachAndObserve(live, client);

        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.MainFrameNavigationBlocked,
            Url = "https://blocked.test/",
        });

        var url = await client.WaitRedirectAsync(TimeSpan.FromSeconds(2));
        Assert.Equal("https://blocked.test/", url);
    }

    [Fact]
    public async Task FeatureLoop_Crashed_PushesSessionEndedAndRequestsFaultStop()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var faults = new RecordingFaultScheduler();
        var live = CreateService(faults).Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;
        var client = new RecordingAttachedClient();
        _ = AttachAndObserve(live, client);

        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.Crashed,
            ErrorCode = "browser_closed",
            Message = "Chrome context closed",
            Phase = "runtime",
        });

        var ended = await client.WaitSessionEndedAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(sessionId, ended.SessionId);
        Assert.Equal("Faulted", ended.Reason);
        Assert.Equal("browser_closed", ended.ErrorCode);

        var stop = await faults.WaitStopAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(sessionId, stop.SessionId);
        Assert.Equal(StopReason.Faulted, stop.Reason);
    }

    [Fact]
    public async Task FeatureLoop_Crashed_JournalsLiveSessionAbandoned()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var faults = new RecordingFaultScheduler();
        var liveEvents = new RecordingSessionLiveEvents();
        var live = CreateService(faults, liveEvents: liveEvents)
            .Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;
        var client = new RecordingAttachedClient();
        _ = AttachAndObserve(live, client);

        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.Crashed,
            ErrorCode = "browser_closed",
            Message = "Chrome context closed",
            Phase = "runtime",
        });

        await client.WaitSessionEndedAsync(TimeSpan.FromSeconds(2));
        Assert.NotNull(liveEvents.LastAbandoned);
        Assert.Equal("Faulted", liveEvents.LastAbandoned!.Value.Reason);
        Assert.Equal("browser_closed", liveEvents.LastAbandoned.Value.ErrorCode);
    }

    [Fact]
    public async Task FeatureLoop_SecondCrashed_DoesNotReAbandon()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var faults = new RecordingFaultScheduler();
        var live = CreateService(faults).Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;
        var client = new RecordingAttachedClient();
        _ = AttachAndObserve(live, client);

        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.Crashed,
            ErrorCode = "browser_closed",
            Message = "first",
            Phase = "runtime",
        });

        await client.WaitSessionEndedAsync(TimeSpan.FromSeconds(2));
        await faults.WaitStopAsync(TimeSpan.FromSeconds(2));

        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.Crashed,
            ErrorCode = "browser_closed",
            Message = "second",
            Phase = "runtime",
        });

        await Task.Delay(150);
        Assert.Equal(1, client.SessionEndedCount);
        Assert.Equal(1, faults.StopCount);
    }

    [Fact]
    public async Task FeatureLoop_NotificationChannelCompleted_AbandonsSession()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var faults = new RecordingFaultScheduler();
        var liveEvents = new RecordingSessionLiveEvents();
        var live = CreateService(faults, liveEvents: liveEvents)
            .Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;
        var client = new RecordingAttachedClient();
        _ = AttachAndObserve(live, client);

        connection.Notifications.Writer.TryComplete();

        var ended = await client.WaitSessionEndedAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(sessionId, ended.SessionId);
        Assert.Equal("Faulted", ended.Reason);
        Assert.Equal("sidecar_connection_ended", ended.ErrorCode);

        var stop = await faults.WaitStopAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(StopReason.Faulted, stop.Reason);
        Assert.NotNull(liveEvents.LastAbandoned);
        Assert.Equal("Faulted", liveEvents.LastAbandoned!.Value.Reason);
        Assert.Equal("sidecar_connection_ended", liveEvents.LastAbandoned.Value.ErrorCode);
    }

    [Fact]
    public async Task FeatureLoop_EmptyUrl_DoesNotCallClient()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;
        var client = new RecordingAttachedClient();
        _ = AttachAndObserve(live, client);

        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.LocationChanged,
            Url = "   ",
        });
        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.LocationChanged,
            Url = "https://example.test/after-empty",
        });

        var url = await client.WaitSyncUrlAsync(TimeSpan.FromSeconds(2));
        Assert.Equal("https://example.test/after-empty", url);
        Assert.Equal(1, client.SyncUrlCount);
    }

    [Fact]
    public async Task FeatureLoop_Detach_StopsPushingUntilReattach()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var browse = new RecordingSessionBrowseTelemetryEvents();
        var live = CreateService(telemetry: new NoOpSessionTelemetryEventsFactory(browse: browse))
            .Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;
        var first = new RecordingAttachedClient();
        var attachmentId = AttachAndObserve(live, first);

        Assert.True(live.Detach(attachmentId).IsSuccess);

        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.LocationChanged,
            Url = "https://example.test/while-detached",
        });

        // Journal still runs while detached; wait for drain before reattach (no Task.Delay race).
        var drained = await browse.WaitLocationChangedAsync(TimeSpan.FromSeconds(2));
        Assert.Equal("https://example.test/while-detached", drained);
        Assert.Equal(0, first.SyncUrlCount);

        var second = new RecordingAttachedClient();
        Assert.True(live.Attach(second).IsSuccess); // feature loop already observing
        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.LocationChanged,
            Url = "https://example.test/reattached",
        });

        var url = await second.WaitSyncUrlAsync(TimeSpan.FromSeconds(2));
        Assert.Equal("https://example.test/reattached", url);
    }

    [Fact]
    public async Task Notifications_Broadcast()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var stream = live.OpenNotificationStream(Guid.NewGuid()).Value;
        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.LocationChanged,
            Url = "https://example.test/",
        });

        var received = await stream.GetNotificationChannel().Value.ReadAsync();
        Assert.Equal(SessionNotificationKind.LocationChanged, received.Kind);
    }

    [Fact]
    public async Task Navigate_SendsClientPathToSidecar()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var liveEvents = new RecordingSessionLiveEvents();
        var navigateEvents = new RecordingSessionNavigateTelemetryEvents();
        var live = CreateService(
                liveEvents: liveEvents,
                telemetry: new NoOpSessionTelemetryEventsFactory(navigate: navigateEvents))
            .Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true)
            .Value;

        var result = await live.NavigateAsync(new NavigateSession { Path = "/x", Query = "q=1" });
        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Applied);
        Assert.Equal(NavigateOutcome.Applied, result.Value.Outcome);
        Assert.Equal("/x", connection.LastNavigatedClientPath);
        Assert.Equal("q=1", connection.LastNavigatedClientQuery);
        Assert.Equal(("/x", "q=1"), liveEvents.LastNavigateRequested);
        Assert.Equal("/x?q=1", navigateEvents.LastUrlResolved);
        Assert.Equal("/x?q=1", liveEvents.LastNavigateCompletedUrl);
        Assert.Null(liveEvents.LastNavigateFailedPhase);
    }

    [Fact]
    public async Task Navigate_WhenSidecarResolveFails_JournalsNavigateFailed()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId) { NavigateClientFails = true };
        var liveEvents = new RecordingSessionLiveEvents();
        var live = CreateService(liveEvents: liveEvents)
            .Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true)
            .Value;

        var result = await live.NavigateAsync(new NavigateSession { Path = "bad", Query = "" });
        Assert.True(result.IsSuccess);
        Assert.False(result.Value.Applied);
        Assert.Equal(NavigateOutcome.ResolveFailed, result.Value.Outcome);
        Assert.Equal("Resolve", liveEvents.LastNavigateFailedPhase);
        Assert.Null(connection.LastNavigatedClientPath);
    }

    [Fact]
    public async Task Resize_WhenCommandGateBusy_ReturnsResizeBusy()
    {
        var sessionId = Guid.NewGuid();
        var resizeEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var connection = new LiveFakeConnection(sessionId)
        {
            ResizeDelay = TimeSpan.FromMilliseconds(800),
            ResizeEntered = resizeEntered,
        };
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var first = live.ResizeAsync(new ResizeSession
        {
            Width = 800,
            Height = 600,
            RequestId = "resize-1",
        });
        // Wait until the first resize holds the command gate (past coalesce debounce), not a fixed sleep.
        await resizeEntered.Task.WaitAsync(TimeSpan.FromSeconds(5));

        var second = await live.ResizeAsync(new ResizeSession
        {
            Width = 900,
            Height = 700,
            RequestId = "resize-2",
        });

        Assert.True(second.IsSuccess);
        Assert.False(second.Value.Applied);
        Assert.Equal(ResizeOutcome.Busy, second.Value.Outcome);
        Assert.Equal("resize_busy", second.Value.ErrorCode);
        Assert.Equal("validate", second.Value.Phase);
        Assert.Equal("resize-2", second.Value.ResizeId);

        var firstResult = await first;
        Assert.True(firstResult.IsSuccess);
        Assert.True(firstResult.Value.Applied);
        Assert.Equal(ResizeOutcome.Applied, firstResult.Value.Outcome);
    }

    [Fact]
    public async Task ExclusiveInput_PreemptiveClaim_StealsOwnership()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var configuration = SessionsTestHarness.Configuration(new SessionsConfiguration
        {
            IsJsBridgeEnabled = true,
            DetachedSessionTimeout = TimeSpan.FromMinutes(5),
            MirrorMode = MirrorMode.VideoStreaming,
            InputMultiplexingPolicy = new InputMultiplexingPolicy
            {
                Access = InputAccessPolicy.Exclusive,
                Ownership = InputOwnershipPolicy.PreemptiveClaim,
                Scheduling = InputSchedulingPolicy.ArrivalOrder,
            },
        });

        var service = CreateService(configuration);
        var live = service.Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var inputA = Channel.CreateUnbounded<VideoStreamingInput>();
        var inputB = Channel.CreateUnbounded<VideoStreamingInput>();
        Assert.True(live.ConsumeVideoStreamingInputAsync(Guid.NewGuid(), inputA.Reader).IsSuccess);
        Assert.True(live.ConsumeVideoStreamingInputAsync(Guid.NewGuid(), inputB.Reader).IsSuccess);
    }

    [Fact]
    public async Task GetStatus_PassesThroughSidecarProjectedUrl()
    {
        var sessionId = Guid.NewGuid();
        const string projected = "https://speculum.test/page?q=1&_w7s_nso=eyJ2IjoxLCJoIjoicGFnZSJ9";
        var connection = new LiveFakeConnection(sessionId)
        {
            StatusUrl = projected,
        };
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var status = await live.GetStatusAsync();
        Assert.True(status.IsSuccess);
        Assert.Equal(projected, status.Value.Url);
    }

    [Fact]
    public async Task GetStatus_PollsConnection()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var status = await live.GetStatusAsync();
        Assert.True(status.IsSuccess);
        Assert.Equal(sessionId.ToString("D"), status.Value.SessionId);
        Assert.True(status.Value.JsBridgeEnabled);
        Assert.True(status.Value.UptimeMs > 0);
    }

    [Fact]
    public async Task ConsoleInput_WithJsBridgeDisabled_IsRejectedWithoutStoppingSession()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", false).Value;
        var input = Channel.CreateUnbounded<ConsoleInput>();

        var consume = live.ConsumeConsoleInputAsync(Guid.NewGuid(), input.Reader);

        Assert.True(consume.IsFailure);
        Assert.True((await live.GetStatusAsync()).IsSuccess);
    }

    [Fact]
    public async Task Hooks_RegisterCamera_InvokedViaConnectionCallback()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        Assert.Equal(PermissionDecision.Deny, await connection.CameraHandler!(CancellationToken.None));

        Assert.True(live.RegisterCameraPermission(_ => Task.FromResult(PermissionDecision.Allow)).IsSuccess);
        Assert.Equal(PermissionDecision.Allow, await connection.CameraHandler!(CancellationToken.None));
    }

    [Fact]
    public async Task Hooks_Multiplex_AnyDeny_FailsClosed()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        Assert.True(live.RegisterCameraPermission(_ => Task.FromResult(PermissionDecision.Allow)).IsSuccess);
        Assert.True(live.RegisterCameraPermission(_ => Task.FromResult(PermissionDecision.Deny)).IsSuccess);
        Assert.Equal(PermissionDecision.Deny, await connection.CameraHandler!(CancellationToken.None));
    }

    [Fact]
    public async Task Release_DetachesHooksAndRejectsOps()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var service = CreateService();
        var live = service.Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        Assert.True(live.RegisterCameraPermission(_ => Task.FromResult(PermissionDecision.Allow)).IsSuccess);
        service.Release(sessionId);

        Assert.False(service.TryGet(sessionId, out _));
        Assert.Equal(PermissionDecision.Deny, await connection.CameraHandler!(CancellationToken.None));
        Assert.True(live.OpenFrameStream(Guid.NewGuid()).IsFailure);
        Assert.True((await live.GetStatusAsync()).IsFailure);
    }

    [Fact]
    public async Task ExclusiveInput_SecondPumpFails()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var configuration = SessionsTestHarness.Configuration(new SessionsConfiguration
        {
            IsJsBridgeEnabled = true,
            DetachedSessionTimeout = TimeSpan.FromMinutes(5),
            MirrorMode = MirrorMode.VideoStreaming,
            InputMultiplexingPolicy = new InputMultiplexingPolicy
            {
                Access = InputAccessPolicy.Exclusive,
            },
        });

        var service = CreateService(configuration);
        var live = service.Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var inputA = Channel.CreateUnbounded<VideoStreamingInput>();
        var inputB = Channel.CreateUnbounded<VideoStreamingInput>();
        Assert.True(live.ConsumeVideoStreamingInputAsync(Guid.NewGuid(), inputA.Reader).IsSuccess);
        var second = live.ConsumeVideoStreamingInputAsync(Guid.NewGuid(), inputB.Reader);
        Assert.True(second.IsFailure);
    }

    [Fact]
    public async Task ExclusiveInput_AfterFirstPumpEnds_NextPumpSucceeds()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var configuration = SessionsTestHarness.Configuration(new SessionsConfiguration
        {
            IsJsBridgeEnabled = true,
            DetachedSessionTimeout = TimeSpan.FromMinutes(5),
            MirrorMode = MirrorMode.VideoStreaming,
            InputMultiplexingPolicy = new InputMultiplexingPolicy
            {
                Access = InputAccessPolicy.Exclusive,
            },
        });

        var service = CreateService(configuration);
        var live = service.Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var inputA = Channel.CreateUnbounded<VideoStreamingInput>();
        var first = live.ConsumeVideoStreamingInputAsync(Guid.NewGuid(), inputA.Reader);
        Assert.True(first.IsSuccess);
        inputA.Writer.TryComplete();
        await first.Value;

        var inputB = Channel.CreateUnbounded<VideoStreamingInput>();
        Assert.True(live.ConsumeVideoStreamingInputAsync(Guid.NewGuid(), inputB.Reader).IsSuccess);
    }

    [Fact]
    public async Task FeatureLoop_CommandFailure_JournalsAttachedClientCommandFailed()
    {
        var sessionId = Guid.NewGuid();
        var profileId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var clientEvents = new RecordingSessionClientTelemetryEvents();
        var service = CreateService(telemetry: new NoOpSessionTelemetryEventsFactory(clientEvents));
        var live = service.Create(sessionId, profileId, connection, "speculum.test", true).Value;
        _ = AttachAndObserve(live, new ThrowingAttachedClient());

        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.LocationChanged,
            Url = "https://example.test/fail",
        });

        await clientEvents.WaitCommandFailedAsync(TimeSpan.FromSeconds(2));
        Assert.Equal("SyncUrl", clientEvents.LastCommand);
    }

    private static LiveSessionService CreateService(
        IConfigurationService? configuration = null,
        ISessionCollector? collector = null,
        ISessionLiveEvents? liveEvents = null,
        ISessionTelemetryEventsFactory? telemetry = null,
        Speculum.Api.Journal.Services.JournalCatalog? journalCatalog = null)
    {
        var config = configuration ?? SessionsTestHarness.Configuration(new SessionsConfiguration
        {
            IsJsBridgeEnabled = true,
            DetachedSessionTimeout = TimeSpan.FromMinutes(5),
            MirrorMode = MirrorMode.VideoStreaming,
            InputMultiplexingPolicy = new InputMultiplexingPolicy
            {
                Access = InputAccessPolicy.Shared,
            },
        });
        return new LiveSessionService(
            collector ?? new NoOpCollector(),
            new NoOpFaultScheduler(),
            config,
            new NoOpSessionEventsFactory(liveEvents ?? new NoOpSessionLiveEvents()),
            telemetry ?? new NoOpSessionTelemetryEventsFactory(),
            journalCatalog ?? new Speculum.Api.Journal.Services.JournalCatalog(),
            NullLoggerFactory.Instance);
    }

    private static LiveSessionService CreateService(
        ISessionFaultScheduler faults,
        ISessionCollector? collector = null,
        ISessionLiveEvents? liveEvents = null,
        ISessionTelemetryEventsFactory? telemetry = null,
        Speculum.Api.Journal.Services.JournalCatalog? journalCatalog = null)
    {
        var config = SessionsTestHarness.Configuration(new SessionsConfiguration
        {
            IsJsBridgeEnabled = true,
            DetachedSessionTimeout = TimeSpan.FromMinutes(5),
            MirrorMode = MirrorMode.VideoStreaming,
            InputMultiplexingPolicy = new InputMultiplexingPolicy
            {
                Access = InputAccessPolicy.Shared,
            },
        });
        return new LiveSessionService(
            collector ?? new NoOpCollector(),
            faults,
            config,
            new NoOpSessionEventsFactory(liveEvents ?? new NoOpSessionLiveEvents()),
            telemetry ?? new NoOpSessionTelemetryEventsFactory(),
            journalCatalog ?? new Speculum.Api.Journal.Services.JournalCatalog(),
            NullLoggerFactory.Instance);
    }

    [Fact]
    public void TraceVideoStreamingInputDataPlaneReceived_WhenCatalogDisabled_IsNoOp()
    {
        var catalog = new Speculum.Api.Journal.Services.JournalCatalog();
        catalog.RegisterFromAssemblies(typeof(Speculum.Api.Telemetry.Events.Models.Sampling.SampleCollected).Assembly);
        var input = new RecordingSessionVideoStreamingInputTelemetryEvents();
        var sessionId = Guid.NewGuid();
        var live = CreateService(
                telemetry: new NoOpSessionTelemetryEventsFactory(videoStreamingInput: input),
                journalCatalog: catalog)
            .Create(sessionId, Guid.NewGuid(), new LiveFakeConnection(sessionId), "speculum.test", true)
            .Value;

        live.TraceVideoStreamingInputDataPlaneReceived("click");

        Assert.Null(input.LastDataPlaneKind);
    }

    [Fact]
    public void TraceVideoStreamingInputDataPlaneReceived_WhenCatalogEnabled_JournalsHop()
    {
        var catalog = new Speculum.Api.Journal.Services.JournalCatalog();
        catalog.RegisterFromAssemblies(typeof(Speculum.Api.Telemetry.Events.Models.Sampling.SampleCollected).Assembly);
        catalog.SetEnabled(Speculum.Api.Telemetry.TelemetryJournalFacts.VideoStreamingInputDataPlaneReceived, true);
        var input = new RecordingSessionVideoStreamingInputTelemetryEvents();
        var sessionId = Guid.NewGuid();
        var live = CreateService(
                telemetry: new NoOpSessionTelemetryEventsFactory(videoStreamingInput: input),
                journalCatalog: catalog)
            .Create(sessionId, Guid.NewGuid(), new LiveFakeConnection(sessionId), "speculum.test", true)
            .Value;

        live.TraceVideoStreamingInputDataPlaneReceived("click", "trace-hf-1", 99);

        Assert.Equal("click", input.LastDataPlaneKind);
        Assert.Equal("trace-hf-1", input.LastDataPlaneTraceId);
        Assert.Equal(99, input.LastDataPlaneClientTimestampMs);
    }

    [Fact]
    public void VideoStreamingInput_HighFrequencyKinds_StillJournalWhenFactsEnabled()
    {
        // M2: .NET is a dumb pipe; sidecar coalesces. Journal emits whenever catalog is on.
        var catalog = new Speculum.Api.Journal.Services.JournalCatalog();
        catalog.RegisterFromAssemblies(typeof(Speculum.Api.Telemetry.Events.Models.Sampling.SampleCollected).Assembly);
        catalog.SetEnabled(Speculum.Api.Telemetry.TelemetryJournalFacts.VideoStreamingInputDataPlaneReceived, true);
        catalog.SetEnabled(Speculum.Api.Telemetry.TelemetryJournalFacts.VideoStreamingInputSidecarPushWritten, true);
        catalog.SetEnabled(Speculum.Api.Telemetry.TelemetryJournalFacts.VideoStreamingInputApplied, true);
        var input = new RecordingSessionVideoStreamingInputTelemetryEvents();
        var sessionId = Guid.NewGuid();
        var live = CreateService(
                telemetry: new NoOpSessionTelemetryEventsFactory(videoStreamingInput: input),
                journalCatalog: catalog)
            .Create(sessionId, Guid.NewGuid(), new LiveFakeConnection(sessionId), "speculum.test", true)
            .Value;

        live.TraceVideoStreamingInputDataPlaneReceived("mousemove", "hf-trace", 1);
        Assert.Equal("mousemove", input.LastDataPlaneKind);
        Assert.Equal("hf-trace", input.LastDataPlaneTraceId);

        // Applied / SidecarPushWritten are driven by connection notifications — assert emitters accept HF kinds.
        input.Applied("mousemove", "touch", "hf-trace", 1);
        input.SidecarPushWritten("mousemove", null, "hf-trace", 1);
        Assert.Equal("mousemove", input.LastAppliedKind);
        Assert.Equal("hf-trace", input.LastAppliedTraceId);
        Assert.Equal("mousemove", input.LastPushKind);
    }

    private sealed class NoOpSessionEventsFactory(ISessionLiveEvents liveEvents) : ISessionEventsFactory
    {
        public ISessionLifecycleEvents ForSessionLifecycle(Guid sessionId, Guid profileId)
            => throw new NotSupportedException();

        public ISessionStartEvents ForSessionStart(Guid sessionId, Guid profileId)
            => throw new NotSupportedException();

        public ISessionStopEvents ForSessionStop(Guid sessionId, Guid profileId)
            => throw new NotSupportedException();

        public ISessionLiveEvents ForSessionLive(Guid sessionId, Guid profileId)
            => liveEvents;

        public ISessionLifecycleEvents ForSessionLifecycle(Session session)
            => throw new NotSupportedException();

        public ISessionStartEvents ForSessionStart(Session session)
            => throw new NotSupportedException();

        public ISessionStopEvents ForSessionStop(Session session)
            => throw new NotSupportedException();

        public ISessionLiveEvents ForSessionLive(Session session)
            => liveEvents;
    }

    private sealed class RecordingSessionLiveEvents : ISessionLiveEvents
    {
        public (string Path, string Query)? LastNavigateRequested { get; private set; }
        public string? LastNavigateCompletedUrl { get; private set; }
        public string? LastNavigateFailedPhase { get; private set; }
        public (string Reason, string? ErrorCode, string? Message)? LastAbandoned { get; private set; }

        public void FeatureLoopFaulted(Exception exception) { }

        public void NavigateRequested(string path, string query)
            => LastNavigateRequested = (path, query);

        public void NavigateCompleted(string url)
            => LastNavigateCompletedUrl = url;

        public void NavigateFailed(string phase, Aidan.Core.Errors.Error[] errors)
            => LastNavigateFailedPhase = phase;

        public void MainFrameNavigationBlocked(string url, string? errorCode, string? message) { }
        public void BrowserCrashed(string? errorCode, string? message, string? phase) { }

        public void LiveSessionAbandoned(string reason, string? errorCode, string? message)
            => LastAbandoned = (reason, errorCode, message);
    }

    private sealed class RecordingSessionClientTelemetryEvents : ISessionClientTelemetryEvents
    {
        private readonly TaskCompletionSource<string> _commandFailed = new(
            TaskCreationOptions.RunContinuationsAsynchronously);

        public string? LastCommand { get; private set; }

        public void AttachedCommandFailed(string command, Exception exception)
        {
            LastCommand = command;
            _commandFailed.TrySetResult(command);
        }

        public async Task WaitCommandFailedAsync(TimeSpan timeout)
        {
            var completed = await Task.WhenAny(_commandFailed.Task, Task.Delay(timeout));
            Assert.Same(_commandFailed.Task, completed);
            await _commandFailed.Task;
        }
    }

    private sealed class RecordingSessionNavigateTelemetryEvents : ISessionNavigateTelemetryEvents
    {
        public string? LastUrlResolved { get; private set; }

        public void UrlResolved(string url) => LastUrlResolved = url;
    }

    private sealed class RecordingSessionBrowseTelemetryEvents : ISessionBrowseTelemetryEvents
    {
        private readonly TaskCompletionSource<string> _locationChanged = new(
            TaskCreationOptions.RunContinuationsAsynchronously);

        public void LocationChanged(string url)
            => _locationChanged.TrySetResult(url);

        public async Task<string> WaitLocationChangedAsync(TimeSpan timeout)
        {
            var completed = await Task.WhenAny(_locationChanged.Task, Task.Delay(timeout));
            Assert.Same(_locationChanged.Task, completed);
            return await _locationChanged.Task;
        }
    }

    private sealed class RecordingSessionVideoStreamingInputTelemetryEvents
        : ISessionVideoStreamingInputTelemetryEvents
    {
        public string? LastDataPlaneKind { get; private set; }
        public string? LastDataPlaneTraceId { get; private set; }
        public long? LastDataPlaneClientTimestampMs { get; private set; }
        public string? LastAppliedKind { get; private set; }
        public string? LastAppliedTraceId { get; private set; }
        public string? LastPushKind { get; private set; }

        public void Applied(string kind, string? phase, string? traceId = null, long? clientTimestampMs = null)
        {
            LastAppliedKind = kind;
            LastAppliedTraceId = traceId;
        }

        public void Rejected(
            string? errorCode,
            string? message,
            string? phase,
            string? traceId = null,
            long? clientTimestampMs = null) { }

        public void DataPlaneReceived(string kind, string? traceId = null, long? clientTimestampMs = null)
        {
            LastDataPlaneKind = kind;
            LastDataPlaneTraceId = traceId;
            LastDataPlaneClientTimestampMs = clientTimestampMs;
        }

        public void ControlReceived(string kind, string? traceId = null, long? clientTimestampMs = null) { }

        public void SidecarPushWritten(
            string kind,
            string? phase,
            string? traceId = null,
            long? clientTimestampMs = null)
            => LastPushKind = kind;

        public void SidecarAdmitted(string kind, string? traceId = null, long? clientTimestampMs = null) { }
    }

    private sealed class ThrowingAttachedClient : IAttachedSessionClient
    {
        public Task SyncUrlAsync(string url, CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("sync failed");

        public Task RedirectAsync(string url, CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("redirect failed");

        public Task EditableFocusChangedAsync(
            EditingState? editing,
            CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("focus push failed");

        public Task SessionEndedAsync(
            Guid sessionId,
            string reason,
            string? errorCode = null,
            string? message = null,
            CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("session ended push failed");
    }

    private sealed class NoOpFaultScheduler : ISessionFaultScheduler
    {
        public void RequestStop(Guid sessionId, StopReason reason) { }
    }

    private sealed class RecordingFaultScheduler : ISessionFaultScheduler
    {
        private readonly TaskCompletionSource<(Guid SessionId, StopReason Reason)> _stop = new(
            TaskCreationOptions.RunContinuationsAsynchronously);

        public (Guid SessionId, StopReason Reason)? LastStop { get; private set; }

        public int StopCount { get; private set; }

        public void RequestStop(Guid sessionId, StopReason reason)
        {
            StopCount++;
            LastStop = (sessionId, reason);
            _stop.TrySetResult((sessionId, reason));
        }

        public async Task<(Guid SessionId, StopReason Reason)> WaitStopAsync(TimeSpan timeout)
        {
            var completed = await Task.WhenAny(_stop.Task, Task.Delay(timeout));
            Assert.Same(_stop.Task, completed);
            return await _stop.Task;
        }
    }

    private static DomainPattern ExactDomain(params string[] labels)
        => new()
        {
            Scope = PatternScope.Pattern,
            Labels = labels
                .Select(value => new DomainLabelPattern
                {
                    Match = PatternPartMatch.Exact,
                    Value = value,
                })
                .ToArray(),
        };

    private static DomainPattern WildcardDomain(params string[] apexLabels)
        => new()
        {
            Scope = PatternScope.Pattern,
            Labels =
            [
                new DomainLabelPattern { Match = PatternPartMatch.Any },
                .. apexLabels.Select(value => new DomainLabelPattern
                {
                    Match = PatternPartMatch.Exact,
                    Value = value,
                }),
            ],
        };

    private sealed class RecordingUrlResolver : IUrlResolver
    {
        private readonly string _url;
        public RecordingUrlResolver(string url) => _url = url;
        public string? LastPath { get; private set; }

        public string? LastRequestHost { get; private set; }

        public IResult<string> Resolve(string path, string query, string requestHost)
        {
            LastPath = path;
            LastRequestHost = requestHost;
            return Result<string>.Success(_url);
        }
    }

    private sealed class FailingUrlResolver : IUrlResolver
    {
        public IResult<string> Resolve(string path, string query, string requestHost)
            => Result<string>.Failure("Navigation path must be absolute and contain no query");
    }

    private sealed class NoOpCollector : ISessionCollector
    {
        public void Watch(Guid sessionId) { }
        public void AddRef(Guid sessionId) { }
        public void Release(Guid sessionId) { }
        public void Unwatch(Guid sessionId) { }
    }

    private sealed class RecordingCollector : ISessionCollector
    {
        public int AddRefs { get; private set; }
        public int Releases { get; private set; }

        public void Watch(Guid sessionId) { }
        public void AddRef(Guid sessionId) => AddRefs++;
        public void Release(Guid sessionId) => Releases++;
        public void Unwatch(Guid sessionId) { }
    }

    private sealed class RecordingAttachedClient : IAttachedSessionClient
    {
        private readonly TaskCompletionSource<string> _syncUrl = new(
            TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<string> _redirect = new(
            TaskCreationOptions.RunContinuationsAsynchronously);

        public int SyncUrlCount { get; private set; }

        public int SessionEndedCount { get; private set; }

        public Task SyncUrlAsync(string url, CancellationToken cancellationToken = default)
        {
            SyncUrlCount++;
            _syncUrl.TrySetResult(url);
            return Task.CompletedTask;
        }

        public Task RedirectAsync(string url, CancellationToken cancellationToken = default)
        {
            _redirect.TrySetResult(url);
            return Task.CompletedTask;
        }

        public Task EditableFocusChangedAsync(
            EditingState? editing,
            CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task SessionEndedAsync(
            Guid sessionId,
            string reason,
            string? errorCode = null,
            string? message = null,
            CancellationToken cancellationToken = default)
        {
            SessionEndedCount++;
            LastSessionEnded = (sessionId, reason, errorCode, message);
            _sessionEnded.TrySetResult(LastSessionEnded.Value);
            return Task.CompletedTask;
        }

        public (Guid SessionId, string Reason, string? ErrorCode, string? Message)? LastSessionEnded
        {
            get;
            private set;
        }

        private readonly TaskCompletionSource<(Guid SessionId, string Reason, string? ErrorCode, string? Message)>
            _sessionEnded = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task<string> WaitSyncUrlAsync(TimeSpan timeout)
        {
            var completed = await Task.WhenAny(_syncUrl.Task, Task.Delay(timeout));
            Assert.Same(_syncUrl.Task, completed);
            return await _syncUrl.Task;
        }

        public async Task<string> WaitRedirectAsync(TimeSpan timeout)
        {
            var completed = await Task.WhenAny(_redirect.Task, Task.Delay(timeout));
            Assert.Same(_redirect.Task, completed);
            return await _redirect.Task;
        }

        public async Task<(Guid SessionId, string Reason, string? ErrorCode, string? Message)>
            WaitSessionEndedAsync(TimeSpan timeout)
        {
            var completed = await Task.WhenAny(_sessionEnded.Task, Task.Delay(timeout));
            Assert.Same(_sessionEnded.Task, completed);
            return await _sessionEnded.Task;
        }
    }

    private sealed class LiveFakeConnection : ISessionConnection
    {
        public LiveFakeConnection(Guid sessionId)
        {
            SessionId = sessionId;
            Frames = Channel.CreateUnbounded<Frame>();
            PageProjectionFrames = Channel.CreateUnbounded<PageProjectionFrame>();
            Console = Channel.CreateUnbounded<ConsoleOutput>();
            Notifications = Channel.CreateUnbounded<SessionNotification>();
            VideoStreamingInputReceived = Channel.CreateUnbounded<VideoStreamingInput>();
            PageProjectionIntentReceived = Channel.CreateUnbounded<PageProjectionIntent>();
            ConsoleInputReceived = Channel.CreateUnbounded<ConsoleInput>();
        }

        public Guid SessionId { get; }
        public bool IsOpen { get; set; } = true;
        public Channel<Frame> Frames { get; }
        public Channel<PageProjectionFrame> PageProjectionFrames { get; }
        public Channel<ConsoleOutput> Console { get; }
        public Channel<SessionNotification> Notifications { get; }
        public Channel<VideoStreamingInput> VideoStreamingInputReceived { get; }
        public Channel<PageProjectionIntent> PageProjectionIntentReceived { get; }
        public Channel<ConsoleInput> ConsoleInputReceived { get; }
        public string? LastNavigatedUrl { get; private set; }
        public string? LastNavigatedClientPath { get; private set; }
        public string? LastNavigatedClientQuery { get; private set; }
        public bool NavigateClientFails { get; set; }
        public Func<CancellationToken, Task<PermissionDecision>>? CameraHandler { get; private set; }
        public Func<CancellationToken, Task<PermissionDecision>>? MicrophoneHandler { get; private set; }

        public Task<IResult> CloseAsync(CancellationToken ct = default)
        {
            IsOpen = false;
            return Task.FromResult<IResult>(Result.Success());
        }

        public Task<IResult<BrowserReadyInfo>> LaunchBrowserAsync(
            SessionConfig? configuration,
            string requestHost,
            CancellationToken ct = default)
            => Task.FromResult<IResult<BrowserReadyInfo>>(Result<BrowserReadyInfo>.Success(new BrowserReadyInfo
            {
                Width = 800,
                Height = 600,
            }));

        public Task<IResult> NavigateAsync(string url, CancellationToken ct = default)
        {
            LastNavigatedUrl = url;
            return Task.FromResult<IResult>(Result.Success());
        }

        public Task<IResult> NavigateClientAsync(string path, string query, CancellationToken ct = default)
        {
            if (NavigateClientFails)
            {
                return Task.FromResult<IResult>(Result.Failure("Navigation path must be absolute and contain no query"));
            }

            LastNavigatedClientPath = path;
            LastNavigatedClientQuery = query;
            return Task.FromResult<IResult>(Result.Success());
        }

        public Task<IResult> StopBrowserAsync(CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult<SessionState>> ExportSessionStateAsync(CancellationToken ct = default)
            => Task.FromResult<IResult<SessionState>>(Result<SessionState>.Success(new SessionState()));

        public Task<IResult<CookieNormalizeStats>> RestoreProfileStateAsync(ProfileState state, CancellationToken ct = default)
            => Task.FromResult<IResult<CookieNormalizeStats>>(Result<CookieNormalizeStats>.Success(CookieNormalizeStats.Empty));

        public Task<IResult> RefreshAsync(CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public TimeSpan ResizeDelay { get; set; }

        /// <summary>Signaled when <see cref="ResizeAsync"/> has entered (after command gate).</summary>
        public TaskCompletionSource? ResizeEntered { get; set; }

        public Task<IResult<ResizeResult>> ResizeAsync(
            string requestId,
            int width,
            int height,
            DeviceProfile device,
            CancellationToken ct = default)
            => ResizeDelayedAsync(requestId, width, height, ct);

        private async Task<IResult<ResizeResult>> ResizeDelayedAsync(
            string requestId,
            int width,
            int height,
            CancellationToken ct)
        {
            ResizeEntered?.TrySetResult();
            if (ResizeDelay > TimeSpan.Zero)
            {
                await Task.Delay(ResizeDelay, ct).ConfigureAwait(false);
            }

            return Result<ResizeResult>.Success(new ResizeResult
            {
                Applied = true,
                Outcome = ResizeOutcome.Applied,
                Width = width,
                Height = height,
                ResizeId = requestId,
            });
        }

        public Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
            DiagProbeRequest request,
            CancellationToken ct = default)
            => Task.FromResult<IResult<DiagProbeResult>>(Result<DiagProbeResult>.Success(new DiagProbeResult { Ok = true }));

        public IResult<ChannelReader<Frame>> GetFrameReader()
            => Result<ChannelReader<Frame>>.Success(Frames.Reader);

        public IResult<ChannelReader<PageProjectionFrame>> GetPageProjectionFrameReader()
            => Result<ChannelReader<PageProjectionFrame>>.Success(PageProjectionFrames.Reader);

        public IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputReader()
            => Result<ChannelReader<ConsoleOutput>>.Success(Console.Reader);

        public string? StatusUrl { get; set; }

        public Task<IResult<SessionStatus>> GetStatusAsync(CancellationToken ct = default)
            => Task.FromResult<IResult<SessionStatus>>(Result<SessionStatus>.Success(new SessionStatus
            {
                SessionId = SessionId.ToString("D"),
                TabCount = 1,
                Url = StatusUrl ?? "",
            }));

        public IResult<ChannelReader<SessionNotification>> GetNotificationReader()
            => Result<ChannelReader<SessionNotification>>.Success(Notifications.Reader);

        public void SetCameraPermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler)
            => CameraHandler = handler;

        public void SetMicrophonePermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler)
            => MicrophoneHandler = handler;

        public IResult<Task> ConsumeVideoStreamingInputAsync(ChannelReader<VideoStreamingInput> channelReader)
            => Result<Task>.Success(DrainAsync(channelReader, VideoStreamingInputReceived.Writer));

        public IResult<Task> ConsumePageProjectionIntentAsync(ChannelReader<PageProjectionIntent> channelReader)
            => Result<Task>.Success(DrainAsync(channelReader, PageProjectionIntentReceived.Writer));

        public VirtualResourceResponse? VirtualAsset { get; set; }

        public int GetVirtualAssetCallCount { get; private set; }
        public int RequestResyncCallCount { get; private set; }
        public uint LastResyncContextId { get; private set; }
        public string? LastResyncReason { get; private set; }

        public Task<IResult<VirtualResourceResponse>> GetVirtualAssetAsync(
            string key,
            CancellationToken ct = default,
            string? kind = null,
            string? rangeHeader = null)
        {
            GetVirtualAssetCallCount++;
            return VirtualAsset is null
                ? Task.FromResult<IResult<VirtualResourceResponse>>(Result<VirtualResourceResponse>.Failure("not implemented"))
                : Task.FromResult<IResult<VirtualResourceResponse>>(Result<VirtualResourceResponse>.Success(VirtualAsset));
        }

        public Task<IResult> RequestResyncAsync(uint contextId = 1, string? reason = null, CancellationToken ct = default)
        {
            RequestResyncCallCount++;
            LastResyncContextId = contextId;
            LastResyncReason = reason;
            return Task.FromResult<IResult>(Result.Success());
        }

        public Task<IResult> PutDomUploadAsync(
            string uploadId,
            byte[] body,
            string contentType,
            string name,
            CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public IResult<Task> ConsumeConsoleInputAsync(
            System.Threading.Channels.ChannelReader<Speculum.Api.Sessions.Models.ConsoleInput> channelReader)
            => Result<Task>.Failure("not implemented");

        public void BindPageProjectionFrameTelemetry(
            Speculum.Api.BrowserClients.IPageProjectionFrameTelemetry? telemetry) { }


        public bool IsPageProjectionFrameFanOutEnqueuedEnabled() => false;

        public void ReportPageProjectionFrameFanOutEnqueued(
            PageProjectionFrame diff,
            long waitMs,
            Guid streamId,
            Guid consumerId,
            string kind,
            int targetIndex,
            int targetCount,
            int frameChannelCount,
            long frameEpoch) { }

        public void ReportPageProjectionFrameOutputStreamOpened(
            Guid streamId,
            Guid consumerId,
            string kind,
            int openStreamCount,
            int diffChannelCapacity) { }

        public void ReportPageProjectionFrameOutputStreamClosed(
            Guid streamId,
            Guid consumerId,
            string kind,
            int openStreamCount) { }

        public void ReportPageProjectionFrameQueueDropped(
            string stage,
            int droppedCount,
            int capacity,
            long? sequence = null,
            long? generation = null,
            string? plane = null,
            string? operation = null,
            long? lowestDroppedSequence = null,
            long? highestDroppedSequence = null,
            string? reason = null,
            Guid? streamId = null,
            Guid? consumerId = null,
            string? kind = null,
            int? targetCount = null,
            int? frameChannelCount = null,
            long? frameEpoch = null) { }

        public int GetPageProjectionFrameConnectionQueueDepth() => 0;

        public ulong GetPageProjectionFrameConnectionQueuedBytes() => 0;

        public ulong GetPageProjectionFrameOldestQueuedMs() => 0;

        public void NotifyPageProjectionFrameConnectionDequeued() { }

        public void TrySendConsumerPressure(ConsumerPressureSnapshot snapshot) { }

        private static async Task DrainAsync<T>(ChannelReader<T> source, ChannelWriter<T> dest)
        {
            await foreach (var item in source.ReadAllAsync())
            {
                await dest.WriteAsync(item);
            }
        }
    }
}
