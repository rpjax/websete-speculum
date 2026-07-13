using Microsoft.AspNetCore.SignalR;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Motor.Mapping;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Motor.Live;

public sealed class MotorSessionCoordinator
{
    private readonly IMotorSessionRegistry    _registry;
    private readonly ISpeculumConfigStore       _configStore;
    private readonly IBrowserSessionStore       _sessionStore;
    private readonly MotorUrlAdapter            _urlAdapter;
    private readonly IMotorSessionFactory       _sessionFactory;
    private readonly ILogger<MotorSessionCoordinator> _logger;

    public MotorSessionCoordinator(
        IMotorSessionRegistry    registry,
        ISpeculumConfigStore       configStore,
        IBrowserSessionStore       sessionStore,
        MotorUrlAdapter            urlAdapter,
        IMotorSessionFactory       sessionFactory,
        ILogger<MotorSessionCoordinator> logger)
    {
        _registry       = registry;
        _configStore    = configStore;
        _sessionStore   = sessionStore;
        _urlAdapter     = urlAdapter;
        _sessionFactory = sessionFactory;
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

        var resolvedIdentity = ResolveIdentity(identity);

        if (_registry.TryRemove(connectionId, out var oldActive))
        {
            _logger.LogWarning(
                "Conexão {ConnectionId}: sessão anterior não encerrada — capturando e parando.",
                connectionId);

            if (!string.IsNullOrWhiteSpace(oldActive.PersistedSessionId))
            {
                try { await oldActive.CaptureAndPersistAsync(oldActive.PersistedSessionId!, _sessionStore); }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Erro ao persistir estado da sessão anterior.");
                }
            }

            try { await oldActive.StopAsync(); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Erro ao parar sessão anterior.");
            }
        }
        else if (_registry.TryCancelStarting(connectionId, out var oldStarting))
        {
            _logger.LogWarning(
                "Conexão {ConnectionId}: startup anterior ainda em curso — cancelando.",
                connectionId);
            _registry.ReleaseSlot();
            try { await oldStarting.StopAsync(); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Erro ao parar startup anterior.");
            }
        }

        var config     = _configStore.Current;
        var forwarding = config.Forwarding!;

        if (!_registry.TryAcquireSlot(config.MaxSessions!.Value))
            throw new HubException("Limite de sessões simultâneas atingido.");

        IMotorSession? session = null;
        var promoted           = false;
        try
        {
            var (browserSessionId, clientToken) = await _sessionStore.ResolveOrCreateSessionAsync(
                resolvedIdentity, connectionAborted);

            var browserState = await _sessionStore.LoadStateAsync(browserSessionId, connectionAborted);

            motorHost ??= "";
            var profile = HostingProfileResolver.Resolve(motorHost, config.Hosting);

            var initialUrl = InitialUrlBuilder.Build(
                _urlAdapter,
                forwarding,
                clientUrl,
                profile,
                motorHost);

            _logger.LogInformation(
                "Conexão {ConnectionId}: iniciando sessão em {InitialUrl} (sessionId={SessionPrefix}…)",
                connectionId, initialUrl, browserSessionId[..Math.Min(8, browserSessionId.Length)]);

            var (w, h) = ViewportDimensions.Normalize(viewportWidth, viewportHeight);

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

            session = _sessionFactory.Create(sessionSnapshot);
            session.PersistedSessionId = browserSessionId;
            _registry.TrackStarting(connectionId, session);

            await session.StartAsync(connectionAborted);

            if (!_registry.TryPromoteStarting(connectionId, session))
            {
                _logger.LogInformation(
                    "Conexão {ConnectionId} cancelada durante startup — descartando sessão.",
                    connectionId);
                throw new HubException("Sessão cancelada durante startup.");
            }

            promoted = true;
            session  = null;

            return clientToken;
        }
        catch (HubException)
        {
            throw;
        }
        catch (ArgumentException ex)
        {
            throw new HubException(ex.Message);
        }
        catch (OperationCanceledException) when (connectionAborted.IsCancellationRequested)
        {
            _logger.LogInformation(
                "Startup cancelado para ConnectionId={ConnectionId}.",
                connectionId);
            throw new HubException("Sessão cancelada durante startup.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Falha ao iniciar sessão.");
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
                    _registry.ReleaseSlot();
            }
        }
    }

    public async Task HandleDisconnectedAsync(string connectionId)
    {
        if (_registry.TryCancelStarting(connectionId, out var starting))
        {
            _registry.ReleaseSlot();
            try { await starting.StopAsync(); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "Erro ao parar sessão em startup na desconexão (ConnectionId={ConnectionId}).",
                    connectionId);
            }
        }
        else if (_registry.TryRemove(connectionId, out var session))
        {
            if (!string.IsNullOrWhiteSpace(session.PersistedSessionId))
            {
                try { await session.CaptureAndPersistAsync(session.PersistedSessionId!, _sessionStore); }
                catch (Exception ex)
                {
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
        }
    }

    public Task NavigateMotorSessionAsync(string connectionId, string clientUrl, string? motorHost)
    {
        if (string.IsNullOrWhiteSpace(clientUrl))
            throw new HubException("URL de navegação é obrigatória.");

        var config     = _configStore.Current;
        var forwarding = config.Forwarding!;
        motorHost ??= "";
        var profile = HostingProfileResolver.Resolve(motorHost, config.Hosting);

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

        return session.NavigateAsync(targetUrl);
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
                Indexers    = identity.Indexers,
            };
        }

        return identity;
    }
}
