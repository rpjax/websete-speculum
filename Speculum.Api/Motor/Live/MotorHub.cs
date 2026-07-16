using System.Threading.Channels;
using Microsoft.AspNetCore.SignalR;
using Speculum.Api.Motor.Live.Models;

namespace Speculum.Api.Motor.Live;

public sealed class MotorHub : Hub
{
    private readonly IMotorSessionRegistry      _registry;
    private readonly MotorSessionCoordinator      _coordinator;

    public MotorHub(
        IMotorSessionRegistry registry,
        MotorSessionCoordinator coordinator)
    {
        _registry    = registry;
        _coordinator = coordinator;
    }

    public Task<string> StartSessionAsync(
        string clientUrl,
        int viewportWidth,
        int viewportHeight,
        SessionIdentity? identity,
        DeviceProfile? device = null)
        => _coordinator.StartSessionAsync(
            Context.ConnectionId,
            Context.GetHttpContext()?.Request.Host.Value,
            Context.ConnectionAborted,
            clientUrl,
            viewportWidth,
            viewportHeight,
            identity,
            device);

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await _coordinator.HandleDisconnectedAsync(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    public ChannelReader<Frame> OpenFrameChannel()
        => RequireSession().GetFrameReader();

    public ChannelReader<ConsoleOutput> OpenConsoleOutputChannel()
        => RequireSession().GetConsoleOutputReader();

    public ChannelReader<SessionStatus> OpenStatusChannel()
        => RequireSession().GetStatusReader();

    public Task OpenUserInputChannel(ChannelReader<string> channelReader)
        => RequireSession().ConsumeUserInputAsync(channelReader);

    public Task OpenConsoleInputChannel(ChannelReader<ConsoleInput> channelReader)
        => RequireSession().ConsumeConsoleInputAsync(channelReader);

    public Task NavigateAsync(string clientUrl)
        => _coordinator.NavigateMotorSessionAsync(
            Context.ConnectionId,
            clientUrl,
            Context.GetHttpContext()?.Request.Host.Value);

    public Task ResizeAsync(int width, int height, DeviceProfile? device = null)
        => RequireSession().ResizeAsync(width, height, device);

    private IMotorSession RequireSession()
    {
        var session = _registry.Get(Context.ConnectionId);
        if (session is null)
            throw new HubException("Sessão não iniciada. Chame StartSessionAsync primeiro.");
        return session;
    }
}
