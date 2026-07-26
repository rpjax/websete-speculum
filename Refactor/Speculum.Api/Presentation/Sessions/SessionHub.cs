using Microsoft.AspNetCore.SignalR;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Presentation.Sessions.Dtos;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// SignalR control plane for live sessions (RPCs only).
/// Data-plane pipes/streams belong on WebTransport, not this hub.
/// </summary>
public sealed class SessionHub : Hub
{
    private readonly ISessionService _sessions;
    private readonly IConfigurationService _configuration;
    private readonly ISessionBindingRegistry _bindings;

    public SessionHub(
        ISessionService sessions,
        IConfigurationService configuration,
        ISessionBindingRegistry bindings)
    {
        _sessions = sessions;
        _configuration = configuration;
        _bindings = bindings;
    }

    public async Task<StartSessionHubResponse> StartSessionAsync(StartSessionHubRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var requestHost = Context.GetHttpContext()?.Request.Host.Value;
        if (string.IsNullOrWhiteSpace(requestHost))
        {
            throw new HubException("Request host is required");
        }

        StartSession start;
        try
        {
            start = StartSessionEdgeMapper.Map(
                request,
                requestHost,
                Context.ConnectionId,
                _configuration.GetCurrent());
        }
        catch (ArgumentException ex)
        {
            throw new HubException(ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            throw new HubException(ex.Message);
        }

        var result = await _sessions.StartSessionAsync(
            start,
            Context.ConnectionAborted);

        if (result.IsFailure)
        {
            throw new HubException(SessionHubRequestMapper.FormatErrors(result));
        }

        return new StartSessionHubResponse
        {
            SessionId = result.Value.SessionId,
            Token = result.Value.Token,
        };
    }

    public async Task StopSessionAsync(StopSessionHubRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var stop = SessionHubRequestMapper.ToStopSession(request);
        if (!_bindings.IsAuthorized(
                Context.ConnectionId,
                stop.SessionId,
                stop.Token))
        {
            throw new HubException("Session binding is not authorized");
        }

        var result = await _sessions.StopSessionAsync(
            stop,
            Context.ConnectionAborted);

        if (result.IsFailure)
        {
            throw new HubException(SessionHubRequestMapper.FormatErrors(result));
        }
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _bindings.CloseCaller(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }
}
