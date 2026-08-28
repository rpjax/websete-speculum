using System.Runtime.CompilerServices;
using System.Threading.Channels;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Presentation.Journal;
using Speculum.Api.Presentation.Sessions.Dtos;
using Speculum.Api.Profiles.Requests;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// SignalR control plane for live sessions: RPCs plus the Journal observation stream.
/// Data streams (frames, user input, console) use the data-plane carrier (/vtransport or /vstream).
/// StartSession attaches the hub client before return. Control-plane disconnect stops the
/// live session immediately (<see cref="StopReason.Disconnected"/>); DetachedSessionTimeout
/// remains the backstop when presence drops without a hub close.
/// </summary>
public sealed class SessionHub : Hub<ISessionHubClient>
{
    private readonly ISessionService _sessions;
    private readonly ILiveSessionService _liveSessions;
    private readonly IConfigurationService _configuration;
    private readonly ISessionBindingRegistry _bindings;
    private readonly IProfileService _profiles;
    private readonly IJournalLiveFeed _journalFeed;
    private readonly ILogger<SessionHub> _logger;

    public SessionHub(
        ISessionService sessions,
        ILiveSessionService liveSessions,
        IConfigurationService configuration,
        ISessionBindingRegistry bindings,
        IProfileService profiles,
        IJournalLiveFeed journalFeed,
        ILogger<SessionHub> logger)
    {
        _sessions = sessions;
        _liveSessions = liveSessions;
        _configuration = configuration;
        _bindings = bindings;
        _profiles = profiles;
        _journalFeed = journalFeed;
        _logger = logger;
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
        // Setup mode: profile ensure stays available while mandatory config is pending.
        // StartSession remains gated via EnsureOperational.

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
        EnsureOperational();

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
            MirrorMode = result.Value.MirrorMode,
        };
    }

    private void EnsureOperational()
    {
        if (_configuration.AreMandatorySettingsSatisfied)
            return;

        var missing = string.Join(", ", _configuration.MissingRequired);
        throw new HubException(
            $"Pending config: mandatory settings incomplete ({missing}).");
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

    /// <summary>
    /// Runtime navigation against the caller's bound live session (path/query → target URL).
    /// </summary>
    public async Task<NavigateSessionHubResponse> NavigateAsync(NavigateSessionHubRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var navigate = SessionHubRequestMapper.ToNavigateSession(request);
        if (!_bindings.IsAuthorized(
                Context.ConnectionId,
                navigate.SessionId,
                request.Token ?? string.Empty))
        {
            throw new HubException("Session binding is not authorized");
        }

        if (!_liveSessions.TryGet(navigate.SessionId, out var live))
        {
            throw new HubException("Live session not found");
        }

        var result = await live.NavigateAsync(navigate, Context.ConnectionAborted);
        if (result.IsFailure)
        {
            throw new HubException(SessionHubRequestMapper.FormatErrors(result));
        }

        return SessionHubRequestMapper.ToNavigateResponse(result.Value);
    }

    /// <summary>
    /// Runtime viewport resize against the caller's bound live session (canvas 1:1).
    /// </summary>
    public async Task<ResizeSessionHubResponse> ResizeAsync(ResizeSessionHubRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!_bindings.IsAuthorized(
                Context.ConnectionId,
                request.SessionId,
                request.Token ?? string.Empty))
        {
            throw new HubException("Session binding is not authorized");
        }

        if (!_liveSessions.TryGet(request.SessionId, out var live))
        {
            throw new HubException("Live session not found");
        }

        var resize = SessionHubRequestMapper.ToResizeSession(request);
        var result = await live.ResizeAsync(resize, Context.ConnectionAborted);
        if (result.IsFailure)
        {
            throw new HubException(SessionHubRequestMapper.FormatErrors(result));
        }

        return SessionHubRequestMapper.ToResizeResponse(result.Value);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var liveSessionId = _bindings.CloseCaller(Context.ConnectionId);
        if (liveSessionId is Guid sessionId)
        {
            // Do not wait on Context.ConnectionAborted — disconnect already cancelled it.
            var stop = await _sessions.StopSessionAsync(
                    new StopSession
                    {
                        SessionId = sessionId,
                        Reason = StopReason.Disconnected,
                    },
                    CancellationToken.None)
                .ConfigureAwait(false);
            if (stop.IsFailure)
            {
                _logger.LogWarning(
                    "Hub disconnect stop for session {SessionId} failed: {Errors}",
                    sessionId,
                    string.Join("; ", stop.Errors.Select(static e => e.Message)));
            }
        }

        await base.OnDisconnectedAsync(exception).ConfigureAwait(false);
    }
}
