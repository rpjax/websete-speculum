using System.Runtime.CompilerServices;
using System.Threading.Channels;
using Microsoft.AspNetCore.SignalR;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Presentation.Journal;
using Speculum.Api.Presentation.Sessions.Dtos;
using Speculum.Api.Profiles.Requests;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// SignalR control plane for live sessions: RPCs plus the Journal observation stream.
/// Session data-plane pipes (frames, input, console) belong on WebTransport, not this hub.
/// </summary>
public sealed class SessionHub : Hub<ISessionHubClient>
{
    private readonly ISessionService _sessions;
    private readonly IConfigurationService _configuration;
    private readonly ISessionBindingRegistry _bindings;
    private readonly IProfileService _profiles;
    private readonly IJournalLiveFeed _journalFeed;

    public SessionHub(
        ISessionService sessions,
        IConfigurationService configuration,
        ISessionBindingRegistry bindings,
        IProfileService profiles,
        IJournalLiveFeed journalFeed)
    {
        _sessions = sessions;
        _configuration = configuration;
        _bindings = bindings;
        _profiles = profiles;
        _journalFeed = journalFeed;
    }

    /// <summary>
    /// Streams Journal facts as the Journal admits them, for live observation.
    /// </summary>
    /// <remarks>
    /// Every item carries its catalog identity, so the stream stays domain-agnostic:
    /// what a caller sees is exactly what the catalog admitted. This is not the durable
    /// read path — facts already stored before the subscription are not replayed, and a
    /// caller that stops reading loses its oldest buffered facts.
    /// </remarks>
    public async IAsyncEnumerable<JournalFactHubEvent> StreamJournalAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        using var subscription = _journalFeed.Subscribe();
        await foreach (var entry in subscription.Reader.ReadAllAsync(cancellationToken))
        {
            yield return JournalFactHubEventMapper.Map(entry);
        }
    }

    /// <summary>
    /// Resolves the caller's profile (creating one when unknown) so that
    /// <see cref="StartSessionAsync"/> has persisted state to bind to.
    /// </summary>
    public async Task<EnsureProfileHubResponse> EnsureProfileAsync(
        EnsureProfileHubRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var result = await _profiles.EnsureProfileAsync(
            new EnsureProfile
            {
                ProfileId = request.ProfileId,
                CorrelationId = request.CorrelationId,
            },
            Context.ConnectionAborted);

        if (result.IsFailure)
        {
            throw new HubException(SessionHubRequestMapper.FormatErrors(result));
        }

        return new EnsureProfileHubResponse
        {
            ProfileId = result.Value.ProfileId,
            Created = result.Value.Created,
        };
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

        var connectionId = Context.ConnectionId;
        if (string.IsNullOrEmpty(connectionId))
        {
            throw new HubException("Connection id is required");
        }

        start.AttachedClient = new SignalRAttachedSessionClient(Clients.Client(connectionId));

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
