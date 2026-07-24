using Microsoft.AspNetCore.SignalR;
using Speculum.Api.Presentation.Sessions.Dtos;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// SignalR control plane for live sessions (RPCs only).
/// Data-plane pipes/streams belong on WebTransport, not this hub.
/// </summary>
public sealed class SessionHub : Hub
{
    private readonly ISessionService _sessions;

    public SessionHub(ISessionService sessions)
    {
        _sessions = sessions;
    }

    public async Task<StartSessionHubResponse> StartSessionAsync(StartSessionHubRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var result = await _sessions.StartSessionAsync(
            SessionHubRequestMapper.ToStartSession(request),
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

        var result = await _sessions.StopSessionAsync(
            SessionHubRequestMapper.ToStopSession(request),
            Context.ConnectionAborted);

        if (result.IsFailure)
        {
            throw new HubException(SessionHubRequestMapper.FormatErrors(result));
        }
    }
}
