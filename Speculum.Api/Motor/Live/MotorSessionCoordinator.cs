using Microsoft.AspNetCore.SignalR;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Motor.Diagnostics;
using Speculum.Api.Motor.Mapping;
using Speculum.Api.Motor.Sidecar;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Motor.Live;

public sealed class MotorSessionCoordinator
{
    private readonly IMotorSessionRegistry    _registry;
    private readonly ISpeculumConfigStore       _configStore;
    private readonly IBrowserSessionStore       _sessionStore;
    private readonly MotorUrlAdapter            _urlAdapter;
    private readonly IMotorSessionFactory       _sessionFactory;
    private readonly IMotorEventsFactory        _events;
    private readonly ILogger<MotorSessionCoordinator> _logger;

    public MotorSessionCoordinator(
        IMotorSessionRegistry    registry,
        ISpeculumConfigStore       configStore,
        IBrowserSessionStore       sessionStore,
        MotorUrlAdapter            urlAdapter,
        IMotorSessionFactory       sessionFactory,
        IMotorEventsFactory        events,
        ILogger<MotorSessionCoordinator> logger)
    {
        _registry       = registry;
        _configStore    = configStore;
        _sessionStore   = sessionStore;
        _urlAdapter     = urlAdapter;
        _sessionFactory = sessionFactory;
        _events         = events;
        _logger         = logger;
    }

    public async Task<string> StartSessionAsync(
        string connectionId,
        string? motorHost,
        CancellationToken connectionAborted,
        string clientUrl,
        int viewportWidth,
        int viewportHeight,
        SessionIdentity? identity,
        DeviceProfile? device = null)
    {
        if (string.IsNullOrWhiteSpace(clientUrl))
            throw new HubException("clientUrl é obrigatório.");

        if (!_configStore.IsOperational)
        {
            var missing = string.Join(", ", _configStore.MissingRequired);
            throw new HubException(
                $"Motor não configurado. Seções obrigatórias em falta: {missing}. " +
                "Configure via /api/admin/config.");
        }

        SessionIdentity resolvedIdentity;
        var clientTokenProvided = !string.IsNullOrWhiteSpace(identity?.ClientToken);
        try
        {
            resolvedIdentity = ResolveIdentity(identity);
        }
        catch (ArgumentException ex)
        {
            // HubException messages reach SignalR clients; bare ArgumentException does not.
            throw new HubException(ex.Message);
        }

        var correlationId = string.IsNullOrWhiteSpace(resolvedIdentity.CorrelationId)
            ? Guid.NewGuid().ToString("N")
            : resolvedIdentity.CorrelationId!.Trim();

        var events = _events.Begin(connectionId, correlationId);

        var (w, h) = ViewportDimensions.Normalize(viewportWidth, viewportHeight);
        var deviceProfile = ViewportDimensions.NormalizeDevice(device);
        events.SessionStarting(clientUrl, w, h, clientTokenProvided);

        if (_registry.TryRemove(connectionId, out var oldActive))
        {
            _logger.LogWarning(
                "Conexão {ConnectionId}: sessão anterior não encerrada — capturando e parando.",
                connectionId);

            var oldEvents = _events.ForSession(connectionId, correlationId, oldActive);
            if (!string.IsNullOrWhiteSpace(oldActive.PersistedSessionId))
            {
                try
                {
                    oldEvents.StateExportRequested();
                    var replaced = await oldActive.CaptureAndPersistAsync(
                        oldActive.PersistedSessionId!, _sessionStore);
                    oldEvents.StateExportCompleted(
                        replaced?.Cookies.Count,
                        replaced?.LocalStorage.Count,
                        replaced?.History.Count);
                }
                catch (Exception ex)
                {
                    oldEvents.StateExportFailed(ex);
                    _logger.LogWarning(ex, "Erro ao persistir estado da sessão anterior.");
                }
            }

            oldEvents.SessionStopping("replace");
            try { await oldActive.StopAsync(); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Erro ao parar sessão anterior.");
            }
            oldEvents.SessionStopped("replace");
        }
        else if (_registry.TryCancelStarting(connectionId, out var oldStarting))
        {
            _logger.LogWarning(
                "Conexão {ConnectionId}: startup anterior ainda em curso — cancelando.",
                connectionId);
            _registry.ReleaseSlot();
            var oldEvents = _events.ForSession(connectionId, correlationId, oldStarting);
            oldEvents.SessionStopping("cancel");
            try { await oldStarting.StopAsync(); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Erro ao parar startup anterior.");
            }
            oldEvents.SessionStopped("cancel");
            events.SlotReleased(_configStore.Current.MaxSessions, _registry.ActiveCount, _registry.StartingCount);
        }

        var config     = _configStore.Current;
        var forwarding = config.Forwarding!;
        var maxSessions = config.MaxSessions!.Value;

        if (!_registry.TryAcquireSlot(maxSessions))
        {
            events.SessionRefused(maxSessions, _registry.ActiveCount, _registry.StartingCount);
            throw new HubException("Limite de sessões simultâneas atingido.");
        }

        events.SlotAcquired(maxSessions, _registry.ActiveCount, _registry.StartingCount);

        IMotorSession? session = null;
        var promoted           = false;
        string? phase = "resolve";
        bool? restored = null;
        bool? stateLoaded = null;
        int? cookieCount = null;

        try
        {
            var resolve = await _sessionStore.ResolveOrCreateSessionAsync(
                resolvedIdentity, connectionAborted);
            var browserSessionId = resolve.SessionId;
            var clientToken = resolve.ClientToken;
            events.SetPersistedSessionId(browserSessionId);
            restored = resolve.Restored;

            var browserState = await _sessionStore.LoadStateAsync(browserSessionId, connectionAborted);
            stateLoaded = browserState is not null;
            cookieCount = browserState?.Cookies.Count ?? 0;

            motorHost ??= "";
            var profile = HostingProfileResolver.Resolve(motorHost, config.Hosting);

            var initialUrl = InitialUrlBuilder.Build(
                _urlAdapter,
                forwarding,
                clientUrl,
                profile,
                motorHost);

            events.SessionResolved(
                clientTokenProvided,
                clientToken,
                resolve.Restored,
                browserState is not null,
                browserState?.Cookies.Count ?? 0,
                browserState?.LocalStorage.Count ?? 0,
                browserState?.History.Count ?? 0,
                initialUrl);

            _logger.LogInformation(
                "Conexão {ConnectionId}: iniciando sessão em {InitialUrl} (sessionId={SessionPrefix}…)",
                connectionId, initialUrl, browserSessionId[..Math.Min(8, browserSessionId.Length)]);

            var sessionSnapshot = new SessionConfigSnapshot
            {
                InitialUrl               = initialUrl,
                Width                    = w,
                Height                   = h,
                Device                   = deviceProfile,
                BrowserState             = browserState,
                Scripts                  = config.ResolvedScripts,
                JsBridgeEnabled          = config.JsBridgeEnabled,
                AllowedNavigationDomains = forwarding.Domains,
                HostingProfile           = profile,
                Forwarding               = forwarding,
                MotorRequestHost         = motorHost,
            };

            phase = "sidecar_create";
            session = _sessionFactory.Create(sessionSnapshot, events);
            session.PersistedSessionId = browserSessionId;
            session.ClientToken = clientToken;
            session.CorrelationId = correlationId;
            session.ConnectionId = connectionId;
            _registry.TrackStarting(connectionId, session);

            await session.StartAsync(connectionAborted);
            // Sidecar Connected only after ConnectAsync succeeds inside StartAsync.
            events.SidecarConnected();

            phase = "promote";
            if (!_registry.TryPromoteStarting(connectionId, session))
            {
                _logger.LogInformation(
                    "Conexão {ConnectionId} cancelada durante startup — descartando sessão.",
                    connectionId);
                throw new HubException("Sessão cancelada durante startup.");
            }

            promoted = true;
            events.SessionPromoted(resolve.Restored);
            events.SessionStarted(resolve.Restored);
            session  = null;

            return clientToken;
        }
        catch (HubException ex)
        {
            events.SessionStartFailed(phase, ex, DiagnosticsSeverity.Error, restored, stateLoaded, cookieCount);
            throw;
        }
        catch (ArgumentException ex)
        {
            events.SessionStartFailed(phase, ex, DiagnosticsSeverity.Error, restored, stateLoaded, cookieCount);
            throw new HubException(ex.Message);
        }
        catch (OperationCanceledException) when (connectionAborted.IsCancellationRequested)
        {
            _logger.LogInformation(
                "Startup cancelado para ConnectionId={ConnectionId}.",
                connectionId);
            events.SessionStartFailed(
                phase,
                new OperationCanceledException("Sessão cancelada durante startup."),
                DiagnosticsSeverity.Warning, restored, stateLoaded, cookieCount);
            throw new HubException("Sessão cancelada durante startup.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Falha ao iniciar sessão.");
            var failPhase = ex is SidecarProtocolException spe
                && spe.ErrorCode == "cookie_import_invalid"
                ? "import_browser_state"
                : phase;
            events.SessionStartFailed(failPhase, ex, DiagnosticsSeverity.Error, restored, stateLoaded, cookieCount);
            throw new HubException("Falha ao iniciar sessão virtual.");
        }
        finally
        {
            if (!promoted)
            {
                var cancelled = false;
                if (session is not null)
                {
                    cancelled = _registry.TryCancelStarting(connectionId, out _);
                    try { await session.StopAsync(); }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Erro ao limpar sessão após falha de startup.");
                    }
                }

                if (cancelled)
                {
                    _registry.ReleaseSlot();
                    events.SlotReleased(maxSessions, _registry.ActiveCount, _registry.StartingCount);
                }
            }
        }
    }

    public async Task HandleDisconnectedAsync(string connectionId)
    {
        if (_registry.TryCancelStarting(connectionId, out var starting))
        {
            // Continue the session's story: reuse its correlation id so start -> stop share a lineage.
            var correlationId = string.IsNullOrWhiteSpace(starting.CorrelationId)
                ? Guid.NewGuid().ToString("N")
                : starting.CorrelationId!;
            _registry.ReleaseSlot();
            var events = _events.ForSession(connectionId, correlationId, starting);
            events.SessionStopping("disconnect");
            try { await starting.StopAsync(); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "Erro ao parar sessão em startup na desconexão (ConnectionId={ConnectionId}).",
                    connectionId);
            }
            events.SessionStopped("disconnect");
            events.SlotReleased(_configStore.Current.MaxSessions, _registry.ActiveCount, _registry.StartingCount);
            events.CloseOpenSpans("disconnect");
        }
        else if (_registry.TryRemove(connectionId, out var session))
        {
            var correlationId = string.IsNullOrWhiteSpace(session.CorrelationId)
                ? Guid.NewGuid().ToString("N")
                : session.CorrelationId!;
            var events = _events.ForSession(connectionId, correlationId, session);
            events.SessionStopping("disconnect");
            if (!string.IsNullOrWhiteSpace(session.PersistedSessionId))
            {
                events.StateExportRequested();
                try
                {
                    var state = await session.CaptureAndPersistAsync(
                        session.PersistedSessionId!, _sessionStore);
                    events.StateExportCompleted(
                        state?.Cookies.Count,
                        state?.LocalStorage.Count,
                        state?.History.Count);
                }
                catch (Exception ex)
                {
                    events.StateExportFailed(ex);
                    _logger.LogWarning(ex,
                        "Erro ao persistir estado (ConnectionId={ConnectionId}).",
                        connectionId);
                }
            }

            try { await session.StopAsync(); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "Erro ao parar sessão na desconexão (ConnectionId={ConnectionId}).",
                    connectionId);
            }

            events.SessionStopped("disconnect");
            events.SlotReleased(_configStore.Current.MaxSessions, _registry.ActiveCount, _registry.StartingCount);
            events.SidecarDisconnected();
            events.CloseOpenSpans("disconnect");
        }
    }

    public async Task NavigateMotorSessionAsync(string connectionId, string clientUrl, string? motorHost)
    {
        if (string.IsNullOrWhiteSpace(clientUrl))
            throw new HubException("URL de navegação é obrigatória.");

        var session = _registry.Get(connectionId);
        if (session is null)
            throw new HubException("Sessão não iniciada. Chame StartSessionAsync primeiro.");

        var config     = _configStore.Current;
        var forwarding = config.Forwarding!;
        motorHost ??= "";
        var profile = HostingProfileResolver.Resolve(motorHost, config.Hosting);
        // Continue the session's story so navigate beats plot inside its lane / span lineage.
        var correlationId = string.IsNullOrWhiteSpace(session.CorrelationId)
            ? Guid.NewGuid().ToString("N")
            : session.CorrelationId!;
        var events = _events.ForSession(connectionId, correlationId, session);

        string targetUrl;
        try
        {
            targetUrl = InitialUrlBuilder.BuildNavigateTarget(
                _urlAdapter,
                forwarding,
                clientUrl,
                profile,
                motorHost);
        }
        catch (ArgumentException ex)
        {
            events.NavigateBlocked(ex.Message, clientUrl);
            throw new HubException(ex.Message);
        }

        events.NavigateRequested(targetUrl, clientUrl);

        try
        {
            await session.NavigateAsync(targetUrl);
            events.NavigateCompleted(targetUrl);
        }
        catch (ArgumentException ex)
        {
            events.NavigateRejected(ex.Message, clientUrl, targetUrl);
            throw new HubException(ex.Message);
        }
    }

    private static SessionIdentity ResolveIdentity(SessionIdentity? identity)
    {
        if (identity is null)
            return new SessionIdentity();

        if (!string.IsNullOrWhiteSpace(identity.ClientToken))
        {
            return new SessionIdentity
            {
                ClientToken = ClientTokenNormalizer.Resolve(identity.ClientToken),
                CorrelationId = identity.CorrelationId,
                Indexers    = identity.Indexers,
            };
        }

        return identity;
    }
}
