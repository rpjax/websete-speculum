using System.Threading.Channels;
using Aidan.Core.Patterns;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Tests;

public sealed class LiveSessionTests
{
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

        var a = live.OpenFrameStream().Value;
        var b = live.OpenFrameStream().Value;

        await connection.Frames.Writer.WriteAsync(new Frame { Sequence = 7 });
        Assert.Equal(7, (await a.GetFramesChannel().Value.ReadAsync()).Sequence);
        Assert.Equal(7, (await b.GetFramesChannel().Value.ReadAsync()).Sequence);
    }

    [Fact]
    public async Task DisposeFrameStream_SiblingStillReceives()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var a = live.OpenFrameStream().Value;
        var b = live.OpenFrameStream().Value;
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

        var first = live.OpenFrameStream().Value;
        first.Dispose();

        var second = live.OpenFrameStream().Value;
        await connection.Frames.Writer.WriteAsync(new Frame { Sequence = 99 });
        Assert.Equal(99, (await second.GetFramesChannel().Value.ReadAsync()).Sequence);
    }

    [Fact]
    public async Task Attach_SingleClient_SecondAttachFails()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var collector = new RecordingCollector();
        var service = CreateService(
            new RecordingUrlResolver("https://example.test/"),
            SessionsTestHarness.Configuration(),
            collector);
        var live = service.Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var stream = live.OpenFrameStream().Value;
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
            Url = "https://example.test/before-attach",
        });

        var client = new RecordingAttachedClient();
        Assert.True(live.Attach(client).IsSuccess);

        var url = await client.WaitSyncUrlAsync(TimeSpan.FromSeconds(2));
        Assert.Equal("https://example.test/before-attach", url);
    }

    [Fact]
    public async Task FeatureLoop_LocationChanged_CallsSyncUrl()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;
        var client = new RecordingAttachedClient();
        Assert.True(live.Attach(client).IsSuccess);

        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.LocationChanged,
            Url = "https://example.test/synced",
        });

        var url = await client.WaitSyncUrlAsync(TimeSpan.FromSeconds(2));
        Assert.Equal("https://example.test/synced", url);
    }

    [Fact]
    public async Task FeatureLoop_MainFrameBlocked_CallsRedirect()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;
        var client = new RecordingAttachedClient();
        Assert.True(live.Attach(client).IsSuccess);

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
        Assert.True(live.Attach(client).IsSuccess);

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
        Assert.True(live.Attach(client).IsSuccess);

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
        Assert.True(live.Attach(client).IsSuccess);

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
        Assert.True(live.Attach(client).IsSuccess);

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
        Assert.True(live.Attach(client).IsSuccess);

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
        var live = CreateService().Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;
        var first = new RecordingAttachedClient();
        var attachmentId = live.Attach(first).Value;

        Assert.True(live.Detach(attachmentId).IsSuccess);

        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.LocationChanged,
            Url = "https://example.test/while-detached",
        });

        await Task.Delay(100);
        Assert.Equal(0, first.SyncUrlCount);

        var second = new RecordingAttachedClient();
        Assert.True(live.Attach(second).IsSuccess);
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

        var stream = live.OpenNotificationStream().Value;
        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.LocationChanged,
            Url = "https://example.test/",
        });

        var received = await stream.GetNotificationChannel().Value.ReadAsync();
        Assert.Equal(SessionNotificationKind.LocationChanged, received.Kind);
    }

    [Fact]
    public async Task Navigate_ResolvesUrlThenCommands()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var urls = new RecordingUrlResolver("https://target.test/");
        var liveEvents = new RecordingSessionLiveEvents();
        var live = CreateService(urls, liveEvents: liveEvents)
            .Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true)
            .Value;

        var result = await live.NavigateAsync(new NavigateSession { Path = "/x", Query = "q=1" });
        Assert.True(result.IsSuccess);
        Assert.Equal("/x", urls.LastPath);
        Assert.Equal("speculum.test", urls.LastRequestHost);
        Assert.Equal("https://target.test/", connection.LastNavigatedUrl);
        Assert.Equal(("/x", "q=1"), liveEvents.LastNavigateRequested);
        Assert.Equal("https://target.test/", liveEvents.LastNavigateResolvedUrl);
        Assert.Equal("https://target.test/", liveEvents.LastNavigateCompletedUrl);
        Assert.Null(liveEvents.LastNavigateFailedPhase);
    }

    [Fact]
    public async Task Navigate_WhenResolveFails_JournalsNavigateFailed()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var urls = new FailingUrlResolver();
        var liveEvents = new RecordingSessionLiveEvents();
        var live = CreateService(urls, liveEvents: liveEvents)
            .Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true)
            .Value;

        var result = await live.NavigateAsync(new NavigateSession { Path = "bad", Query = "" });
        Assert.True(result.IsFailure);
        Assert.Equal("Resolve", liveEvents.LastNavigateFailedPhase);
        Assert.Null(connection.LastNavigatedUrl);
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

        var consume = live.ConsumeConsoleInputAsync(input.Reader);

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
        Assert.True(live.OpenFrameStream().IsFailure);
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
            InputMultiplexingPolicy = new InputMultiplexingPolicy
            {
                Access = InputAccessPolicy.Exclusive,
            },
        });

        var service = CreateService(new RecordingUrlResolver("https://x.test/"), configuration);
        var live = service.Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var inputA = Channel.CreateUnbounded<UserInput>();
        var inputB = Channel.CreateUnbounded<UserInput>();
        Assert.True(live.ConsumeUserInputAsync(inputA.Reader).IsSuccess);
        var second = live.ConsumeUserInputAsync(inputB.Reader);
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
            InputMultiplexingPolicy = new InputMultiplexingPolicy
            {
                Access = InputAccessPolicy.Exclusive,
            },
        });

        var service = CreateService(new RecordingUrlResolver("https://x.test/"), configuration);
        var live = service.Create(sessionId, Guid.NewGuid(), connection, "speculum.test", true).Value;

        var inputA = Channel.CreateUnbounded<UserInput>();
        var first = live.ConsumeUserInputAsync(inputA.Reader);
        Assert.True(first.IsSuccess);
        inputA.Writer.TryComplete();
        await first.Value;

        var inputB = Channel.CreateUnbounded<UserInput>();
        Assert.True(live.ConsumeUserInputAsync(inputB.Reader).IsSuccess);
    }

    [Fact]
    public async Task FeatureLoop_CommandFailure_JournalsAttachedClientCommandFailed()
    {
        var sessionId = Guid.NewGuid();
        var profileId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var liveEvents = new RecordingSessionLiveEvents();
        var service = CreateService(liveEvents: liveEvents);
        var live = service.Create(sessionId, profileId, connection, "speculum.test", true).Value;
        Assert.True(live.Attach(new ThrowingAttachedClient()).IsSuccess);

        await connection.Notifications.Writer.WriteAsync(new SessionNotification
        {
            Kind = SessionNotificationKind.LocationChanged,
            Url = "https://example.test/fail",
        });

        await liveEvents.WaitCommandFailedAsync(TimeSpan.FromSeconds(2));
        Assert.Equal("SyncUrl", liveEvents.LastCommand);
    }

    private static LiveSessionService CreateService(
        IUrlResolver? urls = null,
        IConfigurationService? configuration = null,
        ISessionCollector? collector = null,
        ISessionLiveEvents? liveEvents = null)
    {
        return new LiveSessionService(
            collector ?? new NoOpCollector(),
            new NoOpFaultScheduler(),
            urls ?? new RecordingUrlResolver("https://example.test/"),
            configuration ?? SessionsTestHarness.Configuration(new SessionsConfiguration
            {
                IsJsBridgeEnabled = true,
                DetachedSessionTimeout = TimeSpan.FromMinutes(5),
                InputMultiplexingPolicy = new InputMultiplexingPolicy
                {
                    Access = InputAccessPolicy.Shared,
                },
            }),
            new NoOpSessionEventsFactory(liveEvents ?? new NoOpSessionLiveEvents()),
            NullLoggerFactory.Instance);
    }

    private static LiveSessionService CreateService(
        ISessionFaultScheduler faults,
        ISessionCollector? collector = null,
        ISessionLiveEvents? liveEvents = null)
    {
        return new LiveSessionService(
            collector ?? new NoOpCollector(),
            faults,
            new RecordingUrlResolver("https://example.test/"),
            SessionsTestHarness.Configuration(new SessionsConfiguration
            {
                IsJsBridgeEnabled = true,
                DetachedSessionTimeout = TimeSpan.FromMinutes(5),
                InputMultiplexingPolicy = new InputMultiplexingPolicy
                {
                    Access = InputAccessPolicy.Shared,
                },
            }),
            new NoOpSessionEventsFactory(liveEvents ?? new NoOpSessionLiveEvents()),
            NullLoggerFactory.Instance);
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

    private sealed class NoOpSessionLiveEvents : ISessionLiveEvents
    {
        public void AttachedClientCommandFailed(string command, Exception exception) { }
        public void FeatureLoopFaulted(Exception exception) { }
        public void NavigateRequested(string path, string query) { }
        public void NavigateUrlResolved(string url) { }
        public void NavigateCompleted(string url) { }
        public void NavigateFailed(string phase, Aidan.Core.Errors.Error[] errors) { }
        public void LocationChanged(string url) { }
        public void MainFrameNavigationBlocked(string url, string? errorCode, string? message) { }
        public void BrowserCrashed(string? errorCode, string? message, string? phase) { }
        public void InputRejected(string? errorCode, string? message, string? phase) { }
        public void InputApplied(string kind, string? phase) { }
        public void ResizeApplied(int width, int height, string? resizeId) { }
        public void ResizeRejected(
            int? width,
            int? height,
            string? resizeId,
            string? errorCode,
            string? message,
            string? phase)
        { }
        public void LiveSessionAbandoned(string reason, string? errorCode, string? message) { }
    }

    private sealed class RecordingSessionLiveEvents : ISessionLiveEvents
    {
        private readonly TaskCompletionSource<string> _commandFailed = new(
            TaskCreationOptions.RunContinuationsAsynchronously);

        public string? LastCommand { get; private set; }
        public (string Path, string Query)? LastNavigateRequested { get; private set; }
        public string? LastNavigateResolvedUrl { get; private set; }
        public string? LastNavigateCompletedUrl { get; private set; }
        public string? LastNavigateFailedPhase { get; private set; }
        public string? LastLocationChangedUrl { get; private set; }
        public (string Reason, string? ErrorCode, string? Message)? LastAbandoned { get; private set; }

        public void AttachedClientCommandFailed(string command, Exception exception)
        {
            LastCommand = command;
            _commandFailed.TrySetResult(command);
        }

        public void FeatureLoopFaulted(Exception exception) { }

        public void NavigateRequested(string path, string query)
            => LastNavigateRequested = (path, query);

        public void NavigateUrlResolved(string url)
            => LastNavigateResolvedUrl = url;

        public void NavigateCompleted(string url)
            => LastNavigateCompletedUrl = url;

        public void NavigateFailed(string phase, Aidan.Core.Errors.Error[] errors)
            => LastNavigateFailedPhase = phase;

        public void LocationChanged(string url)
            => LastLocationChangedUrl = url;

        public void MainFrameNavigationBlocked(string url, string? errorCode, string? message) { }
        public void BrowserCrashed(string? errorCode, string? message, string? phase) { }
        public void InputRejected(string? errorCode, string? message, string? phase) { }
        public void InputApplied(string kind, string? phase) { }
        public void ResizeApplied(int width, int height, string? resizeId) { }
        public void ResizeRejected(
            int? width,
            int? height,
            string? resizeId,
            string? errorCode,
            string? message,
            string? phase)
        { }

        public void LiveSessionAbandoned(string reason, string? errorCode, string? message)
            => LastAbandoned = (reason, errorCode, message);

        public async Task WaitCommandFailedAsync(TimeSpan timeout)
        {
            var completed = await Task.WhenAny(_commandFailed.Task, Task.Delay(timeout));
            Assert.Same(_commandFailed.Task, completed);
            await _commandFailed.Task;
        }
    }

    private sealed class ThrowingAttachedClient : IAttachedSessionClient
    {
        public Task SyncUrlAsync(string url, CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("sync failed");

        public Task RedirectAsync(string url, CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("redirect failed");

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
            Console = Channel.CreateUnbounded<ConsoleOutput>();
            Notifications = Channel.CreateUnbounded<SessionNotification>();
            UserInputReceived = Channel.CreateUnbounded<UserInput>();
            ConsoleInputReceived = Channel.CreateUnbounded<ConsoleInput>();
        }

        public Guid SessionId { get; }
        public bool IsOpen { get; set; } = true;
        public Channel<Frame> Frames { get; }
        public Channel<ConsoleOutput> Console { get; }
        public Channel<SessionNotification> Notifications { get; }
        public Channel<UserInput> UserInputReceived { get; }
        public Channel<ConsoleInput> ConsoleInputReceived { get; }
        public string? LastNavigatedUrl { get; private set; }
        public Func<CancellationToken, Task<PermissionDecision>>? CameraHandler { get; private set; }
        public Func<CancellationToken, Task<PermissionDecision>>? MicrophoneHandler { get; private set; }

        public Task<IResult> CloseAsync(CancellationToken ct = default)
        {
            IsOpen = false;
            return Task.FromResult<IResult>(Result.Success());
        }

        public Task<IResult<BrowserReadyInfo>> LaunchBrowserAsync(
            SessionConfig? configuration,
            CancellationToken ct = default)
            => Task.FromResult<IResult<BrowserReadyInfo>>(Result<BrowserReadyInfo>.Success(new BrowserReadyInfo
            {
                Width = 800,
                Height = 600,
            }));

        public Task<IResult> StopBrowserAsync(CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult<SessionState>> ExportSessionStateAsync(CancellationToken ct = default)
            => Task.FromResult<IResult<SessionState>>(Result<SessionState>.Success(new SessionState()));

        public Task<IResult> RestoreProfileStateAsync(ProfileState state, CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult> NavigateAsync(string url, CancellationToken ct = default)
        {
            LastNavigatedUrl = url;
            return Task.FromResult<IResult>(Result.Success());
        }

        public Task<IResult> RefreshAsync(CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult<ResizeResult>> ResizeAsync(
            string requestId,
            int width,
            int height,
            DeviceProfile device,
            CancellationToken ct = default)
            => Task.FromResult<IResult<ResizeResult>>(Result<ResizeResult>.Success(new ResizeResult
            {
                Applied = true,
                Width = width,
                Height = height,
                ResizeId = requestId,
            }));

        public Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
            DiagProbeRequest request,
            CancellationToken ct = default)
            => Task.FromResult<IResult<DiagProbeResult>>(Result<DiagProbeResult>.Success(new DiagProbeResult { Ok = true }));

        public IResult<ChannelReader<Frame>> GetFrameReader()
            => Result<ChannelReader<Frame>>.Success(Frames.Reader);

        public IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputReader()
            => Result<ChannelReader<ConsoleOutput>>.Success(Console.Reader);

        public Task<IResult<SessionStatus>> GetStatusAsync(CancellationToken ct = default)
            => Task.FromResult<IResult<SessionStatus>>(Result<SessionStatus>.Success(new SessionStatus
            {
                SessionId = SessionId.ToString("D"),
                TabCount = 1,
            }));

        public IResult<ChannelReader<SessionNotification>> GetNotificationReader()
            => Result<ChannelReader<SessionNotification>>.Success(Notifications.Reader);

        public void SetCameraPermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler)
            => CameraHandler = handler;

        public void SetMicrophonePermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler)
            => MicrophoneHandler = handler;

        public IResult<Task> ConsumeUserInputAsync(ChannelReader<UserInput> channelReader)
            => Result<Task>.Success(DrainAsync(channelReader, UserInputReceived.Writer));

        public IResult<Task> ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader)
            => Result<Task>.Success(DrainAsync(channelReader, ConsoleInputReceived.Writer));

        private static async Task DrainAsync<T>(ChannelReader<T> source, ChannelWriter<T> dest)
        {
            await foreach (var item in source.ReadAllAsync())
            {
                await dest.WriteAsync(item);
            }
        }
    }
}
