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
    private readonly IMotorDiagnosticsEmitter   _diagnostics;
    private readonly ILogger<MotorSessionCoordinator> _logger;

    public MotorSessionCoordinator(
        IMotorSessionRegistry    registry,
        ISpeculumConfigStore       configStore,
        IBrowserSessionStore       sessionStore,
        MotorUrlAdapter            urlAdapter,
        IMotorSessionFactory       sessionFactory,
        IMotorDiagnosticsEmitter   diagnostics,
        ILogger<MotorSessionCoordinator> logger)
    {
        _registry       = registry;
        _configStore    = configStore;
        _sessionStore   = sessionStore;
        _urlAdapter     = urlAdapter;
        _sessionFactory = sessionFactory;
        _diagnostics    = diagnostics;
        _logger         = logger;
    }

    public async Task<string> StartSessionAsync(
        string connectionId,
        string? motorHost,
        CancellationToken connectionAborted,
        string clientUrl,
        int viewportWidth,
        int viewportHeight,
        SessionIdentity? identity)
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

        var (w, h) = ViewportDimensions.Normalize(viewportWidth, viewportHeight);
        Publish(connectionId, "Motor.SessionStarting", correlationId, payload: new
        {
            clientUrl,
            width = w,
            height = h,
            clientTokenProvided,
        });

        if (_registry.TryRemove(connectionId, out var oldActive))
        {
            _logger.LogWarning(
                "Conexão {ConnectionId}: sessão anterior não encerrada — capturando e parando.",
                connectionId);

            if (!string.IsNullOrWhiteSpace(oldActive.PersistedSessionId))
            {
                try
                {
                    Publish(connectionId, "Motor.StateExportRequested", correlationId, oldActive,
                        payload: new { persistedSessionId = oldActive.PersistedSessionId });
                    var replaced = await oldActive.CaptureAndPersistAsync(
                        oldActive.PersistedSessionId!, _sessionStore);
                    _diagnostics.StateExportCompleted(
                        MotorDiagnosticsContext.For(connectionId, correlationId, oldActive),
                        replaced?.Cookies.Count,
                        replaced?.LocalStorage.Count,
                        replaced?.History.Count);
                }
                catch (Exception ex)
                {
                    _diagnostics.StateExportFailed(
                        MotorDiagnosticsContext.For(connectionId, correlationId, oldActive), ex);
                    _logger.LogWarning(ex, "Erro ao persistir estado da sessão anterior.");
                }
            }

            Publish(connectionId, "Motor.SessionStopping", correlationId, oldActive,
                payload: new { reason = "replace" });
            try { await oldActive.StopAsync(); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Erro ao parar sessão anterior.");
            }
            Publish(connectionId, "Motor.SessionStopped", correlationId, oldActive,
                payload: new { reason = "replace" });
        }
        else if (_registry.TryCancelStarting(connectionId, out var oldStarting))
        {
            _logger.LogWarning(
                "Conexão {ConnectionId}: startup anterior ainda em curso — cancelando.",
                connectionId);
            _registry.ReleaseSlot();
            Publish(connectionId, "Motor.SessionStopping", correlationId, oldStarting,
                payload: new { reason = "cancel" });
            try { await oldStarting.StopAsync(); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Erro ao parar startup anterior.");
            }
            Publish(connectionId, "Motor.SessionStopped", correlationId, oldStarting,
                payload: new { reason = "cancel" });
            Publish(connectionId, "Motor.SlotReleased", correlationId, payload: SlotPayload());
        }

        var config     = _configStore.Current;
        var forwarding = config.Forwarding!;
        var maxSessions = config.MaxSessions!.Value;

        if (!_registry.TryAcquireSlot(maxSessions))
            throw new HubException("Limite de sessões simultâneas atingido.");

        Publish(connectionId, "Motor.SlotAcquired", correlationId, payload: SlotPayload(maxSessions));

        IMotorSession? session = null;
        var promoted           = false;
        string? phase = "resolve";
        string? persistedSessionId = null;
        bool? restored = null;
        bool? stateLoaded = null;
        int? cookieCount = null;

        try
        {
            var resolve = await _sessionStore.ResolveOrCreateSessionAsync(
                resolvedIdentity, connectionAborted);
            var browserSessionId = resolve.SessionId;
            var clientToken = resolve.ClientToken;
            persistedSessionId = browserSessionId;
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

            Publish(connectionId, "Motor.SessionResolved", correlationId, payload: new
            {
                clientTokenProvided,
                clientTokenEffective = clientToken,
                persistedSessionId = browserSessionId,
                restored = resolve.Restored,
                stateLoaded = browserState is not null,
                cookieCount = browserState?.Cookies.Count ?? 0,
                localStorageCount = browserState?.LocalStorage.Count ?? 0,
                historyCount = browserState?.History.Count ?? 0,
                initialUrl,
            }, persistedSessionId: browserSessionId);

            _logger.LogInformation(
                "Conexão {ConnectionId}: iniciando sessão em {InitialUrl} (sessionId={SessionPrefix}…)",
                connectionId, initialUrl, browserSessionId[..Math.Min(8, browserSessionId.Length)]);

            var sessionSnapshot = new SessionConfigSnapshot
            {
                InitialUrl               = initialUrl,
                Width                    = w,
                Height                   = h,
                BrowserState             = browserState,
                Scripts                  = config.ResolvedScripts,
                JsBridgeEnabled          = config.JsBridgeEnabled,
                AllowedNavigationDomains = forwarding.Domains,
                HostingProfile           = profile,
                Forwarding               = forwarding,
                MotorRequestHost         = motorHost,
            };

            phase = "sidecar_create";
            session = _sessionFactory.Create(sessionSnapshot);
            session.PersistedSessionId = browserSessionId;
            session.ClientToken = clientToken;
            session.CorrelationId = correlationId;
            session.ConnectionId = connectionId;
            _registry.TrackStarting(connectionId, session);

            await session.StartAsync(connectionAborted);
            // Sidecar Connected only after ConnectAsync succeeds inside StartAsync.
            Publish(connectionId, "Motor.SidecarConnected", correlationId, session,
                payload: new { sidecarSessionId = session.SidecarSessionId });

            phase = "promote";
            if (!_registry.TryPromoteStarting(connectionId, session))
            {
                _logger.LogInformation(
                    "Conexão {ConnectionId} cancelada durante startup — descartando sessão.",
                    connectionId);
                throw new HubException("Sessão cancelada durante startup.");
            }

            promoted = true;
            Publish(connectionId, "Motor.SessionPromoted", correlationId, session, payload: new
            {
                persistedSessionId = browserSessionId,
                restored = resolve.Restored,
            });
            Publish(connectionId, "Motor.SessionStarted", correlationId, session, payload: new
            {
                persistedSessionId = browserSessionId,
                restored = resolve.Restored,
            });
            session  = null;

            return clientToken;
        }
        catch (HubException ex)
        {
            PublishStartFailed(connectionId, correlationId, session, phase, ex,
                DiagnosticsSeverity.Error, persistedSessionId, restored, stateLoaded, cookieCount);
            throw;
        }
        catch (ArgumentException ex)
        {
            PublishStartFailed(connectionId, correlationId, session, phase, ex,
                DiagnosticsSeverity.Error, persistedSessionId, restored, stateLoaded, cookieCount);
            throw new HubException(ex.Message);
        }
        catch (OperationCanceledException) when (connectionAborted.IsCancellationRequested)
        {
            _logger.LogInformation(
                "Startup cancelado para ConnectionId={ConnectionId}.",
                connectionId);
            PublishStartFailed(connectionId, correlationId, session, phase,
                new OperationCanceledException("Sessão cancelada durante startup."),
                DiagnosticsSeverity.Warning, persistedSessionId, restored, stateLoaded, cookieCount);
            throw new HubException("Sessão cancelada durante startup.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Falha ao iniciar sessão.");
            var failPhase = ex is SidecarProtocolException spe
                && spe.ErrorCode == "cookie_import_invalid"
                ? "import_browser_state"
                : phase;
            PublishStartFailed(connectionId, correlationId, session, failPhase, ex,
                DiagnosticsSeverity.Error, persistedSessionId, restored, stateLoaded, cookieCount);
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
                    Publish(connectionId, "Motor.SlotReleased", correlationId, payload: SlotPayload(maxSessions));
                }
            }
        }
    }

    public async Task HandleDisconnectedAsync(string connectionId)
    {
        var correlationId = Guid.NewGuid().ToString("N");
        if (_registry.TryCancelStarting(connectionId, out var starting))
        {
            _registry.ReleaseSlot();
            Publish(connectionId, "Motor.SessionStopping", correlationId, starting,
                payload: new { reason = "disconnect" });
            try { await starting.StopAsync(); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "Erro ao parar sessão em startup na desconexão (ConnectionId={ConnectionId}).",
                    connectionId);
            }
            Publish(connectionId, "Motor.SessionStopped", correlationId, starting,
                payload: new { reason = "disconnect" });
            Publish(connectionId, "Motor.SlotReleased", correlationId, payload: SlotPayload());
        }
        else if (_registry.TryRemove(connectionId, out var session))
        {
            Publish(connectionId, "Motor.SessionStopping", correlationId, session,
                payload: new { reason = "disconnect" });
            if (!string.IsNullOrWhiteSpace(session.PersistedSessionId))
            {
                Publish(connectionId, "Motor.StateExportRequested", correlationId, session,
                    payload: new { persistedSessionId = session.PersistedSessionId });
                try
                {
                    var state = await session.CaptureAndPersistAsync(
                        session.PersistedSessionId!, _sessionStore);
                    _diagnostics.StateExportCompleted(
                        MotorDiagnosticsContext.For(connectionId, correlationId, session),
                        state?.Cookies.Count,
                        state?.LocalStorage.Count,
                        state?.History.Count);
                }
                catch (Exception ex)
                {
                    _diagnostics.StateExportFailed(
                        MotorDiagnosticsContext.For(connectionId, correlationId, session), ex);
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

            Publish(connectionId, "Motor.SessionStopped", correlationId, session,
                payload: new { reason = "disconnect" });
            Publish(connectionId, "Motor.SlotReleased", correlationId, payload: SlotPayload());
            Publish(connectionId, "Motor.SidecarDisconnected", correlationId, session,
                payload: new { sidecarSessionId = session.SidecarSessionId });
        }
    }

    public async Task NavigateMotorSessionAsync(string connectionId, string clientUrl, string? motorHost)
    {
        if (string.IsNullOrWhiteSpace(clientUrl))
            throw new HubException("URL de navegação é obrigatória.");

        var config     = _configStore.Current;
        var forwarding = config.Forwarding!;
        motorHost ??= "";
        var profile = HostingProfileResolver.Resolve(motorHost, config.Hosting);
        var correlationId = Guid.NewGuid().ToString("N");

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
            throw new HubException(ex.Message);
        }

        var session = _registry.Get(connectionId);
        if (session is null)
            throw new HubException("Sessão não iniciada. Chame StartSessionAsync primeiro.");

        Publish(connectionId, "Motor.NavigateRequested", correlationId, session,
            payload: new { targetUrl, clientUrl });

        try
        {
            await session.NavigateAsync(targetUrl);
            Publish(connectionId, "Motor.NavigateCompleted", correlationId, session,
                payload: new { targetUrl });
        }
        catch (ArgumentException ex)
        {
            _diagnostics.NavigateRejected(
                MotorDiagnosticsContext.For(connectionId, correlationId, session),
                ex.Message, clientUrl, targetUrl);
            throw new HubException(ex.Message);
        }
    }

    private void PublishStartFailed(
        string connectionId,
        string correlationId,
        IMotorSession? session,
        string? phase,
        Exception ex,
        DiagnosticsSeverity severity,
        string? persistedSessionId,
        bool? restored,
        bool? stateLoaded,
        int? cookieCount)
        => _diagnostics.SessionStartFailed(
            MotorDiagnosticsContext.For(connectionId, correlationId, session, persistedSessionId),
            phase, ex, severity, restored, stateLoaded, cookieCount);

    private object SlotPayload(int? maxSessions = null)
        => new
        {
            maxSessions = maxSessions ?? _configStore.Current.MaxSessions,
            activeCount = _registry.ActiveCount,
            startingCount = _registry.StartingCount,
        };

    private void Publish(
        string connectionId,
        string name,
        string correlationId,
        IMotorSession? session = null,
        DiagnosticsSeverity severity = DiagnosticsSeverity.Information,
        object? payload = null,
        string? persistedSessionId = null)
        => _diagnostics.Emit(
            MotorDiagnosticsContext.For(connectionId, correlationId, session, persistedSessionId),
            name, payload, severity);

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
