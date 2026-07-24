using System.Diagnostics.CodeAnalysis;
using System.Threading.Channels;
using Aidan.Core.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.BrowserClients;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Tests;

public sealed class SessionCommandServiceTests
{
    [Fact]
    public async Task GetStatusAsync_PollsLiveConnection()
    {
        var sessionId = Guid.NewGuid();
        var connection = new CommandFakeConnection(sessionId);
        var service = await CreateServiceAsync(sessionId, connection);

        var status = await service.GetStatusAsync(sessionId);

        Assert.True(status.IsSuccess);
        Assert.Equal(sessionId.ToString("D"), status.Value.SessionId);
        Assert.Equal(1, status.Value.TabCount);
    }

    [Fact]
    public async Task NavigateAsync_ResolvesUrlThenCommandsConnection()
    {
        var sessionId = Guid.NewGuid();
        var connection = new CommandFakeConnection(sessionId);
        var urls = new RecordingUrlResolver("https://target.test/search?q=1");
        var service = await CreateServiceAsync(sessionId, connection, urls);

        var result = await service.NavigateAsync(new NavigateSession
        {
            SessionId = sessionId,
            Path = "/search",
            Query = "q=1",
        });

        Assert.True(result.IsSuccess);
        Assert.Equal("/search", urls.LastPath);
        Assert.Equal("q=1", urls.LastQuery);
        Assert.Equal("https://target.test/search?q=1", connection.LastNavigatedUrl);
    }

    [Fact]
    public async Task NavigateAsync_UrlResolveFailure_DoesNotCallConnection()
    {
        var sessionId = Guid.NewGuid();
        var connection = new CommandFakeConnection(sessionId);
        var urls = new FailingUrlResolver("blocked");
        var service = await CreateServiceAsync(sessionId, connection, urls);

        var result = await service.NavigateAsync(new NavigateSession
        {
            SessionId = sessionId,
            Path = "/blocked",
            Query = "",
        });

        Assert.True(result.IsFailure);
        Assert.Null(connection.LastNavigatedUrl);
    }

    [Fact]
    public async Task RefreshAsync_CommandsConnection()
    {
        var sessionId = Guid.NewGuid();
        var connection = new CommandFakeConnection(sessionId);
        var service = await CreateServiceAsync(sessionId, connection);

        var result = await service.RefreshAsync(sessionId);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, connection.RefreshCount);
    }

    [Fact]
    public async Task ResizeAsync_MintsRequestIdAndForwards()
    {
        var sessionId = Guid.NewGuid();
        var connection = new CommandFakeConnection(sessionId);
        var service = await CreateServiceAsync(sessionId, connection);

        var result = await service.ResizeAsync(new ResizeSession
        {
            SessionId = sessionId,
            Width = 1280,
            Height = 720,
            Device = new DeviceProfile { Mobile = true },
        });

        Assert.True(result.IsSuccess);
        Assert.False(string.IsNullOrWhiteSpace(connection.LastResizeRequestId));
        Assert.Equal(1280, connection.LastResizeWidth);
        Assert.Equal(720, connection.LastResizeHeight);
        Assert.True(connection.LastResizeDevice?.Mobile);
        Assert.True(result.Value.Applied);
        Assert.Equal(1280, result.Value.Width);
    }

    [Fact]
    public async Task RequestDiagnosticsAsync_ForwardsProbe()
    {
        var sessionId = Guid.NewGuid();
        var connection = new CommandFakeConnection(sessionId);
        var service = await CreateServiceAsync(sessionId, connection);
        var probe = new DiagProbeRequest { Ops = ["dom"] };

        var result = await service.RequestDiagnosticsAsync(new ProbeSession
        {
            SessionId = sessionId,
            Probe = probe,
        });

        Assert.True(result.IsSuccess);
        Assert.Same(probe, connection.LastProbe);
    }

    [Fact]
    public async Task ResizeAsync_PreservesCallerRequestId()
    {
        var sessionId = Guid.NewGuid();
        var connection = new CommandFakeConnection(sessionId);
        var service = await CreateServiceAsync(sessionId, connection);

        var result = await service.ResizeAsync(new ResizeSession
        {
            SessionId = sessionId,
            RequestId = "resize-42",
            Width = 800,
            Height = 600,
        });

        Assert.True(result.IsSuccess);
        Assert.Equal("resize-42", connection.LastResizeRequestId);
        Assert.Equal("resize-42", result.Value.ResizeId);
    }

    [Fact]
    public async Task GetStatusAsync_NoActiveConnection_Fails()
    {
        var sessionId = Guid.NewGuid();
        var connection = new CommandFakeConnection(sessionId) { IsOpen = false };
        var service = await CreateServiceAsync(sessionId, connection);

        var status = await service.GetStatusAsync(sessionId);

        Assert.True(status.IsFailure);
        Assert.Contains(
            status.Errors,
            e => e.Message?.Contains("active connection", StringComparison.OrdinalIgnoreCase) == true);
    }

    [Fact]
    public async Task GetStatusAsync_SessionNotFound_Fails()
    {
        var connection = new CommandFakeConnection(Guid.NewGuid());
        var service = await CreateServiceAsync(Guid.NewGuid(), connection);

        var status = await service.GetStatusAsync(Guid.NewGuid());

        Assert.True(status.IsFailure);
        Assert.Contains(status.Errors, e => e.Message?.Contains("not found", StringComparison.OrdinalIgnoreCase) == true);
    }

    [Fact]
    public async Task GetStatusAsync_SessionNotLive_Fails()
    {
        var sessionId = Guid.NewGuid();
        var connection = new CommandFakeConnection(sessionId);
        var sessions = new InMemorySessionRepository();
        var stopped = Session.Create(sessionId, Guid.NewGuid());
        stopped.MarkStopped();
        await sessions.SaveAsync(stopped);

        var service = CreateService(connection, sessions, new RecordingUrlResolver("https://x.test/"));

        var status = await service.GetStatusAsync(sessionId);

        Assert.True(status.IsFailure);
        Assert.Contains(status.Errors, e => e.Message?.Contains("not live", StringComparison.OrdinalIgnoreCase) == true);
    }

    private static async Task<SessionCommandService> CreateServiceAsync(
        Guid sessionId,
        ISessionConnection connection,
        IUrlResolver? urls = null)
    {
        var sessions = new InMemorySessionRepository();
        await sessions.SaveAsync(Session.Create(sessionId, Guid.NewGuid()));
        return CreateService(connection, sessions, urls ?? new RecordingUrlResolver("https://example.test/"));
    }

    private static SessionCommandService CreateService(
        ISessionConnection connection,
        ISessionRepository sessions,
        IUrlResolver urls)
    {
        var services = new ServiceCollection();
        services.AddSingleton(sessions);
        var provider = services.BuildServiceProvider();

        return new SessionCommandService(
            new FixedBrowserClient(connection),
            urls,
            provider.GetRequiredService<IServiceScopeFactory>());
    }

    private sealed class RecordingUrlResolver : IUrlResolver
    {
        private readonly string _url;

        public RecordingUrlResolver(string url) => _url = url;

        public string? LastPath { get; private set; }
        public string? LastQuery { get; private set; }

        public IResult<string> Resolve(string path, string query)
        {
            LastPath = path;
            LastQuery = query;
            return Result<string>.Success(_url);
        }
    }

    private sealed class FailingUrlResolver(string message) : IUrlResolver
    {
        public IResult<string> Resolve(string path, string query)
            => Result<string>.Failure(message);
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

    private sealed class FixedBrowserClient(ISessionConnection connection) : IBrowserClient
    {
        public bool TryGetConnection(
            Guid sessionId,
            [NotNullWhen(true)] out ISessionConnection? resolved)
        {
            if (sessionId == connection.SessionId && connection.IsOpen)
            {
                resolved = connection;
                return true;
            }

            resolved = null;
            return false;
        }

        public Task<IResult> UpdateBrowserConfigsAsync(CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult<ISessionConnection>> StartConnectionAsync(
            Guid sessionId,
            CancellationToken ct = default)
            => Task.FromResult<IResult<ISessionConnection>>(Result<ISessionConnection>.Success(connection));
    }

    private sealed class CommandFakeConnection : ISessionConnection
    {
        public CommandFakeConnection(Guid sessionId)
        {
            SessionId = sessionId;
            Frames = Channel.CreateUnbounded<Frame>();
            Console = Channel.CreateUnbounded<ConsoleOutput>();
            Notifications = Channel.CreateUnbounded<SessionNotification>();
        }

        public Guid SessionId { get; }
        public bool IsOpen { get; set; } = true;

        public Channel<Frame> Frames { get; }
        public Channel<ConsoleOutput> Console { get; }
        public Channel<SessionNotification> Notifications { get; }

        public string? LastNavigatedUrl { get; private set; }
        public int RefreshCount { get; private set; }
        public string? LastResizeRequestId { get; private set; }
        public int LastResizeWidth { get; private set; }
        public int LastResizeHeight { get; private set; }
        public DeviceProfile? LastResizeDevice { get; private set; }
        public DiagProbeRequest? LastProbe { get; private set; }

        public Task<IResult> CloseAsync(CancellationToken ct = default)
        {
            IsOpen = false;
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
        {
            LastNavigatedUrl = url;
            return Task.FromResult<IResult>(Result.Success());
        }

        public Task<IResult> RefreshAsync(CancellationToken ct = default)
        {
            RefreshCount++;
            return Task.FromResult<IResult>(Result.Success());
        }

        public Task<IResult<ResizeResult>> ResizeAsync(
            string requestId,
            int width,
            int height,
            DeviceProfile device,
            CancellationToken ct = default)
        {
            LastResizeRequestId = requestId;
            LastResizeWidth = width;
            LastResizeHeight = height;
            LastResizeDevice = device;
            return Task.FromResult<IResult<ResizeResult>>(Result<ResizeResult>.Success(new ResizeResult
            {
                Applied = true,
                Width = width,
                Height = height,
                ResizeId = requestId,
            }));
        }

        public Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
            DiagProbeRequest request,
            CancellationToken ct = default)
        {
            LastProbe = request;
            return Task.FromResult<IResult<DiagProbeResult>>(Result<DiagProbeResult>.Success(new DiagProbeResult
            {
                Ok = true,
            }));
        }

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
            => Result<Task>.Success(Task.CompletedTask);

        public IResult<Task> ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader)
            => Result<Task>.Success(Task.CompletedTask);
    }
}
