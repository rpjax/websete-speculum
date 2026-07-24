using System.Diagnostics.CodeAnalysis;
using System.Threading.Channels;
using Aidan.Core.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Pipes.Services;
using Speculum.Api.Sessions.Pipes.Services.Contracts;
using Speculum.Api.Sessions.Pipes.Streaming;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Shared.Services;

namespace Speculum.Api.Sessions.Tests;

public sealed class SessionPipeStreamTests
{
    [Fact]
    public async Task Broadcast_DeliversSameFrameToAllPipes()
    {
        var connection = new StreamFakeConnection(Guid.NewGuid());
        var multiplexer = CreateMultiplexer(connection, InputAccessPolicy.Shared, jsBridgeEnabled: true);

        var pipeA = RegisterPipe(multiplexer, Guid.NewGuid(), connection.SessionId);
        var pipeB = RegisterPipe(multiplexer, Guid.NewGuid(), connection.SessionId);

        var framesA = pipeA.GetFramesChannel().Value;
        var framesB = pipeB.GetFramesChannel().Value;

        var frame = new Frame { Jpeg = [1, 2, 3], Sequence = 7, Timestamp = 99 };
        await connection.Frames.Writer.WriteAsync(frame);

        var receivedA = await framesA.ReadAsync();
        var receivedB = await framesB.ReadAsync();

        Assert.Equal(7, receivedA.Sequence);
        Assert.Equal(7, receivedB.Sequence);
        Assert.Equal(frame.Jpeg, receivedA.Jpeg);
        Assert.Equal(frame.Jpeg, receivedB.Jpeg);
    }

    [Fact]
    public async Task ClosedPipe_GetFramesChannel_Fails_SiblingStillReceives()
    {
        var connection = new StreamFakeConnection(Guid.NewGuid());
        var multiplexer = CreateMultiplexer(connection, InputAccessPolicy.Shared, jsBridgeEnabled: true);

        var pipeA = RegisterPipe(multiplexer, Guid.NewGuid(), connection.SessionId);
        var pipeB = RegisterPipe(multiplexer, Guid.NewGuid(), connection.SessionId);

        pipeA.Close();

        Assert.True(pipeA.GetFramesChannel().IsFailure);

        var framesB = pipeB.GetFramesChannel().Value;
        await connection.Frames.Writer.WriteAsync(new Frame { Sequence = 1 });
        Assert.Equal(1, (await framesB.ReadAsync()).Sequence);
    }

    [Fact]
    public async Task Broadcast_DeliversSameNotificationToAllPipes()
    {
        var connection = new StreamFakeConnection(Guid.NewGuid());
        var multiplexer = CreateMultiplexer(connection, InputAccessPolicy.Shared, jsBridgeEnabled: true);

        var pipeA = RegisterPipe(multiplexer, Guid.NewGuid(), connection.SessionId);
        var pipeB = RegisterPipe(multiplexer, Guid.NewGuid(), connection.SessionId);

        var notificationsA = pipeA.GetNotificationChannel().Value;
        var notificationsB = pipeB.GetNotificationChannel().Value;

        var notification = new SessionNotification
        {
            Kind = SessionNotificationKind.LocationChanged,
            Url = "https://example.test/",
        };
        await connection.Notifications.Writer.WriteAsync(notification);

        var receivedA = await notificationsA.ReadAsync();
        var receivedB = await notificationsB.ReadAsync();

        Assert.Equal(SessionNotificationKind.LocationChanged, receivedA.Kind);
        Assert.Equal(SessionNotificationKind.LocationChanged, receivedB.Kind);
        Assert.Equal("https://example.test/", receivedA.Url);
        Assert.Equal("https://example.test/", receivedB.Url);
    }

    [Fact]
    public async Task GetStatusAsync_IsOnDemandPoll_NotAStream()
    {
        var connection = new StreamFakeConnection(Guid.NewGuid());
        var multiplexer = CreateMultiplexer(connection, InputAccessPolicy.Shared, jsBridgeEnabled: true);
        var pipe = RegisterPipe(multiplexer, Guid.NewGuid(), connection.SessionId);

        var status = await pipe.GetStatusAsync();
        Assert.True(status.IsSuccess);
        Assert.Equal(connection.SessionId.ToString("D"), status.Value.SessionId);
        Assert.Equal(1, status.Value.TabCount);
    }

    [Fact]
    public void SharedInput_BothPumpsAccepted()
    {
        var connection = new StreamFakeConnection(Guid.NewGuid());
        var multiplexer = CreateMultiplexer(connection, InputAccessPolicy.Shared, jsBridgeEnabled: true);

        var pipeA = RegisterPipe(multiplexer, Guid.NewGuid(), connection.SessionId);
        var pipeB = RegisterPipe(multiplexer, Guid.NewGuid(), connection.SessionId);

        var inputA = Channel.CreateUnbounded<string>();
        var inputB = Channel.CreateUnbounded<string>();

        Assert.True(pipeA.ConsumeUserInputAsync(inputA.Reader).IsSuccess);
        Assert.True(pipeB.ConsumeUserInputAsync(inputB.Reader).IsSuccess);
    }

    [Fact]
    public void ExclusiveInput_SecondPumpFails()
    {
        var connection = new StreamFakeConnection(Guid.NewGuid());
        var multiplexer = CreateMultiplexer(connection, InputAccessPolicy.Exclusive, jsBridgeEnabled: true);

        var pipeA = RegisterPipe(multiplexer, Guid.NewGuid(), connection.SessionId);
        var pipeB = RegisterPipe(multiplexer, Guid.NewGuid(), connection.SessionId);

        var inputA = Channel.CreateUnbounded<string>();
        var inputB = Channel.CreateUnbounded<string>();

        Assert.True(pipeA.ConsumeUserInputAsync(inputA.Reader).IsSuccess);

        var second = pipeB.ConsumeUserInputAsync(inputB.Reader);
        Assert.True(second.IsFailure);
        Assert.Contains(second.Errors, e => e.Message?.Contains("owned", StringComparison.OrdinalIgnoreCase) == true);
    }

    [Fact]
    public void JsBridgeDisabled_ConsoleInputFails()
    {
        var connection = new StreamFakeConnection(Guid.NewGuid());
        var multiplexer = CreateMultiplexer(connection, InputAccessPolicy.Shared, jsBridgeEnabled: false);

        var pipe = RegisterPipe(multiplexer, Guid.NewGuid(), connection.SessionId);
        var input = Channel.CreateUnbounded<ConsoleInput>();

        var result = pipe.ConsumeConsoleInputAsync(input.Reader);
        Assert.True(result.IsFailure);
        Assert.Contains(result.Errors, e => e.Message?.Contains("JsBridge", StringComparison.OrdinalIgnoreCase) == true);
    }

    [Fact]
    public async Task OpenPipeAsync_BroadcastsThroughService()
    {
        var sessionId = Guid.NewGuid();
        var connection = new StreamFakeConnection(sessionId);
        var browser = new FixedBrowserClient(connection);
        var sessions = new InMemorySessionRepository();
        await sessions.SaveAsync(Session.Create(sessionId, Guid.NewGuid()));

        var services = new ServiceCollection();
        services.AddSingleton<ISessionRepository>(sessions);
        var provider = services.BuildServiceProvider();

        var options = Options.Create(new SessionsConfiguration
        {
            IsJsBridgeEnabled = true,
            InputMultiplexingPolicy = new InputMultiplexingPolicy
            {
                Access = InputAccessPolicy.Shared,
            },
        });

        var pipeService = new SessionPipeService(
            browser,
            new NoOpCollector(),
            new ScopedMutex(),
            provider.GetRequiredService<IServiceScopeFactory>(),
            options);

        var openA = await pipeService.OpenPipeAsync(sessionId);
        var openB = await pipeService.OpenPipeAsync(sessionId);
        Assert.True(openA.IsSuccess);
        Assert.True(openB.IsSuccess);

        var framesA = openA.Value.GetFramesChannel().Value;
        var framesB = openB.Value.GetFramesChannel().Value;

        await connection.Frames.Writer.WriteAsync(new Frame { Sequence = 42 });
        Assert.Equal(42, (await framesA.ReadAsync()).Sequence);
        Assert.Equal(42, (await framesB.ReadAsync()).Sequence);
    }

    [Fact]
    public async Task OpenPipeAsync_ReopensAfterAllPipesClosed()
    {
        var sessionId = Guid.NewGuid();
        var connection = new StreamFakeConnection(sessionId);
        var pipeService = await CreatePipeServiceAsync(sessionId, connection);

        var first = await pipeService.OpenPipeAsync(sessionId);
        Assert.True(first.IsSuccess);
        Assert.True(pipeService.ClosePipe(first.Value.Id).IsSuccess);

        var second = await pipeService.OpenPipeAsync(sessionId);
        Assert.True(second.IsSuccess);

        var frames = second.Value.GetFramesChannel().Value;
        await connection.Frames.Writer.WriteAsync(new Frame { Sequence = 99 });
        Assert.Equal(99, (await frames.ReadAsync()).Sequence);
    }

    [Fact]
    public async Task OpenPipeAsync_RebindsWhenConnectionIsReplaced()
    {
        var sessionId = Guid.NewGuid();
        var connectionA = new StreamFakeConnection(sessionId);
        var connectionB = new StreamFakeConnection(sessionId);
        var browser = new SwappableBrowserClient(connectionA);
        var pipeService = await CreatePipeServiceAsync(sessionId, browser);

        var first = await pipeService.OpenPipeAsync(sessionId);
        Assert.True(first.IsSuccess);

        browser.Connection = connectionB;

        var second = await pipeService.OpenPipeAsync(sessionId);
        Assert.True(second.IsSuccess);

        var framesA = first.Value.GetFramesChannel().Value;
        var framesB = second.Value.GetFramesChannel().Value;

        await connectionB.Frames.Writer.WriteAsync(new Frame { Sequence = 7 });
        Assert.Equal(7, (await framesB.ReadAsync()).Sequence);

        await connectionA.Frames.Writer.WriteAsync(new Frame { Sequence = 3 });
        Assert.Equal(3, (await framesA.ReadAsync()).Sequence);
    }

    private static async Task<SessionPipeService> CreatePipeServiceAsync(
        Guid sessionId,
        ISessionConnection connection)
        => await CreatePipeServiceAsync(sessionId, new FixedBrowserClient(connection));

    private static async Task<SessionPipeService> CreatePipeServiceAsync(
        Guid sessionId,
        IBrowserClient browser)
    {
        var sessions = new InMemorySessionRepository();
        await sessions.SaveAsync(Session.Create(sessionId, Guid.NewGuid()));

        var services = new ServiceCollection();
        services.AddSingleton<ISessionRepository>(sessions);
        var provider = services.BuildServiceProvider();

        var options = Options.Create(new SessionsConfiguration
        {
            IsJsBridgeEnabled = true,
            InputMultiplexingPolicy = new InputMultiplexingPolicy
            {
                Access = InputAccessPolicy.Shared,
            },
        });

        return new SessionPipeService(
            browser,
            new NoOpCollector(),
            new ScopedMutex(),
            provider.GetRequiredService<IServiceScopeFactory>(),
            options);
    }

    private static SessionStreamMultiplexer CreateMultiplexer(
        ISessionConnection connection,
        InputAccessPolicy access,
        bool jsBridgeEnabled)
        => new SessionStreamMultiplexer(connection, access, jsBridgeEnabled);

    private static SessionPipe RegisterPipe(
        SessionStreamMultiplexer multiplexer,
        Guid pipeId,
        Guid sessionId)
    {
        var register = multiplexer.RegisterPipe(pipeId);
        Assert.True(register.IsSuccess);
        return new SessionPipe(pipeId, sessionId, multiplexer);
    }

    private sealed class StreamFakeConnection : ISessionConnection
    {
        public StreamFakeConnection(Guid sessionId)
        {
            SessionId = sessionId;
            Frames = Channel.CreateUnbounded<Frame>();
            Console = Channel.CreateUnbounded<ConsoleOutput>();
            Notifications = Channel.CreateUnbounded<SessionNotification>();
            UserInputReceived = Channel.CreateUnbounded<string>();
            ConsoleInputReceived = Channel.CreateUnbounded<ConsoleInput>();
        }

        public Guid SessionId { get; }
        public bool IsOpen { get; private set; } = true;

        public Channel<Frame> Frames { get; }
        public Channel<ConsoleOutput> Console { get; }
        public Channel<SessionNotification> Notifications { get; }
        public Channel<string> UserInputReceived { get; }
        public Channel<ConsoleInput> ConsoleInputReceived { get; }

        public Task<IResult> CloseAsync(CancellationToken ct = default)
        {
            IsOpen = false;
            Frames.Writer.TryComplete();
            Console.Writer.TryComplete();
            Notifications.Writer.TryComplete();
            return Task.FromResult<IResult>(Result.Success());
        }

        public Task<IResult<BrowserReadyInfo>> LaunchBrowserAsync(
            SessionConfig? configuration,
            CancellationToken ct = default)
            => Task.FromResult<IResult<BrowserReadyInfo>>(Result<BrowserReadyInfo>.Failure("n/a"));

        public Task<IResult> StopBrowserAsync(CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult<SessionState>> ExportSessionStateAsync(CancellationToken ct = default)
            => Task.FromResult<IResult<SessionState>>(Result<SessionState>.Failure("n/a"));

        public Task<IResult> RestoreProfileStateAsync(ProfileState state, CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult> NavigateAsync(string url, CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult> RefreshAsync(CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult<ResizeResult>> ResizeAsync(
            string requestId,
            int width,
            int height,
            DeviceProfile device,
            CancellationToken ct = default)
            => Task.FromResult<IResult<ResizeResult>>(Result<ResizeResult>.Failure("n/a"));

        public Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
            DiagProbeRequest request,
            CancellationToken ct = default)
            => Task.FromResult<IResult<DiagProbeResult>>(Result<DiagProbeResult>.Failure("n/a"));

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

        public void SetCameraPermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler) { }

        public void SetMicrophonePermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler) { }

        public IResult<Task> ConsumeUserInputAsync(ChannelReader<string> channelReader)
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

    private sealed class FixedBrowserClient : IBrowserClient
    {
        private readonly ISessionConnection _connection;

        public FixedBrowserClient(ISessionConnection connection) => _connection = connection;

        public bool TryGetConnection(
            Guid sessionId,
            [NotNullWhen(true)] out ISessionConnection? connection)
        {
            if (sessionId == _connection.SessionId && _connection.IsOpen)
            {
                connection = _connection;
                return true;
            }

            connection = null;
            return false;
        }

        public Task<IResult> UpdateBrowserConfigsAsync(CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult<ISessionConnection>> StartConnectionAsync(
            Guid sessionId,
            CancellationToken ct = default)
            => Task.FromResult<IResult<ISessionConnection>>(Result<ISessionConnection>.Success(_connection));
    }

    private sealed class SwappableBrowserClient : IBrowserClient
    {
        public SwappableBrowserClient(ISessionConnection connection) => Connection = connection;

        public ISessionConnection Connection { get; set; }

        public bool TryGetConnection(
            Guid sessionId,
            [NotNullWhen(true)] out ISessionConnection? connection)
        {
            if (sessionId == Connection.SessionId && Connection.IsOpen)
            {
                connection = Connection;
                return true;
            }

            connection = null;
            return false;
        }

        public Task<IResult> UpdateBrowserConfigsAsync(CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult<ISessionConnection>> StartConnectionAsync(
            Guid sessionId,
            CancellationToken ct = default)
            => Task.FromResult<IResult<ISessionConnection>>(Result<ISessionConnection>.Success(Connection));
    }

    private sealed class InMemorySessionRepository : ISessionRepository
    {
        private readonly Dictionary<Guid, Session> _sessions = new();

        public Task<Session?> LoadAsync(Guid sessionId, CancellationToken ct = default)
            => Task.FromResult(_sessions.GetValueOrDefault(sessionId));

        public Task SaveAsync(Session session, CancellationToken ct = default)
        {
            _sessions[session.Id] = session;
            return Task.CompletedTask;
        }
    }

    private sealed class NoOpCollector : ISessionCollector
    {
        public void Watch(Guid sessionId) { }
        public void AddRef(Guid sessionId) { }
        public void Release(Guid sessionId) { }
        public void Unwatch(Guid sessionId) { }
    }
}
