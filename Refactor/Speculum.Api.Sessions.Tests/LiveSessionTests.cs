using System.Threading.Channels;
using Aidan.Core.Patterns;
using Microsoft.Extensions.Options;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Shared.Services;

namespace Speculum.Api.Sessions.Tests;

public sealed class LiveSessionTests
{
    [Fact]
    public async Task Create_OneContextPerSession_SecondCreateFails()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var service = CreateService();

        var created = service.Create(sessionId, connection, "speculum.test", true);
        var again = service.Create(sessionId, connection, "speculum.test", true);

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
        var live = CreateService().Create(sessionId, connection, "speculum.test", true).Value;

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
        var live = CreateService().Create(sessionId, connection, "speculum.test", true).Value;

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
        var live = CreateService().Create(sessionId, connection, "speculum.test", true).Value;

        var first = live.OpenFrameStream().Value;
        first.Dispose();

        var second = live.OpenFrameStream().Value;
        await connection.Frames.Writer.WriteAsync(new Frame { Sequence = 99 });
        Assert.Equal(99, (await second.GetFramesChannel().Value.ReadAsync()).Sequence);
    }

    [Fact]
    public async Task Attachments_NotStreams_HoldCollectorReferences()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var collector = new RecordingCollector();
        var service = CreateService(
            new RecordingUrlResolver("https://example.test/"),
            Options.Create(new SessionsConfiguration()),
            collector);
        var live = service.Create(sessionId, connection, "speculum.test", true).Value;

        var stream = live.OpenFrameStream().Value;
        stream.Dispose();
        Assert.Equal(0, collector.AddRefs);
        Assert.Equal(0, collector.Releases);

        var first = live.Attach().Value;
        var second = live.Attach().Value;
        Assert.Equal(2, collector.AddRefs);

        Assert.True(live.Detach(first).IsSuccess);
        Assert.True(live.Detach(first).IsFailure);
        Assert.Equal(1, collector.Releases);

        service.Release(sessionId);
        Assert.Equal(2, collector.Releases);
        Assert.True(live.Detach(second).IsSuccess);
    }

    [Fact]
    public async Task Notifications_Broadcast()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, connection, "speculum.test", true).Value;

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
        var live = CreateService(urls).Create(sessionId, connection, "speculum.test", true).Value;

        var result = await live.NavigateAsync(new NavigateSession { Path = "/x", Query = "q=1" });
        Assert.True(result.IsSuccess);
        Assert.Equal("/x", urls.LastPath);
        Assert.Equal("speculum.test", urls.LastRequestHost);
        Assert.Equal("https://target.test/", connection.LastNavigatedUrl);
    }

    [Fact]
    public async Task GetStatus_PollsConnection()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, connection, "speculum.test", true).Value;

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
        var live = CreateService().Create(sessionId, connection, "speculum.test", false).Value;
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
        var live = CreateService().Create(sessionId, connection, "speculum.test", true).Value;

        Assert.Equal(PermissionDecision.Deny, await connection.CameraHandler!(CancellationToken.None));

        Assert.True(live.RegisterCameraPermission(_ => Task.FromResult(PermissionDecision.Allow)).IsSuccess);
        Assert.Equal(PermissionDecision.Allow, await connection.CameraHandler!(CancellationToken.None));
    }

    [Fact]
    public async Task Hooks_Multiplex_AnyDeny_FailsClosed()
    {
        var sessionId = Guid.NewGuid();
        var connection = new LiveFakeConnection(sessionId);
        var live = CreateService().Create(sessionId, connection, "speculum.test", true).Value;

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
        var live = service.Create(sessionId, connection, "speculum.test", true).Value;

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
        var options = Options.Create(new SessionsConfiguration
        {
            IsJsBridgeEnabled = true,
            InputMultiplexingPolicy = new InputMultiplexingPolicy
            {
                Access = InputAccessPolicy.Exclusive,
            },
        });

        var service = CreateService(new RecordingUrlResolver("https://x.test/"), options);
        var live = service.Create(sessionId, connection, "speculum.test", true).Value;

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
        var options = Options.Create(new SessionsConfiguration
        {
            IsJsBridgeEnabled = true,
            InputMultiplexingPolicy = new InputMultiplexingPolicy
            {
                Access = InputAccessPolicy.Exclusive,
            },
        });

        var service = CreateService(new RecordingUrlResolver("https://x.test/"), options);
        var live = service.Create(sessionId, connection, "speculum.test", true).Value;

        var inputA = Channel.CreateUnbounded<UserInput>();
        var first = live.ConsumeUserInputAsync(inputA.Reader);
        Assert.True(first.IsSuccess);
        inputA.Writer.TryComplete();
        await first.Value;

        var inputB = Channel.CreateUnbounded<UserInput>();
        Assert.True(live.ConsumeUserInputAsync(inputB.Reader).IsSuccess);
    }

    private static LiveSessionService CreateService(
        IUrlResolver? urls = null,
        IOptions<SessionsConfiguration>? options = null,
        ISessionCollector? collector = null)
    {
        return new LiveSessionService(
            collector ?? new NoOpCollector(),
            urls ?? new RecordingUrlResolver("https://example.test/"),
            options ?? Options.Create(new SessionsConfiguration
            {
                IsJsBridgeEnabled = true,
                InputMultiplexingPolicy = new InputMultiplexingPolicy
                {
                    Access = InputAccessPolicy.Shared,
                },
            }),
            new ScopedMutex());
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
