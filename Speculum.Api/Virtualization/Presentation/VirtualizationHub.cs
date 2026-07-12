using System.Threading.Channels;
using Microsoft.AspNetCore.SignalR;
using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Virtualization.Contracts;
using Speculum.Api.Virtualization.Models;
using Speculum.Api.Virtualization.Options;
using Speculum.Api.Virtualization.Persistence;

namespace Speculum.Api.Virtualization.Presentation;

public sealed class VirtualizationHub : Hub
{
    private readonly IVSessionRegistry           _registry;
    private readonly SidecarBrowserClientOptions _sidecarOptions;
    private readonly ISpeculumConfigStore        _configStore;
    private readonly IBrowserSessionStore        _sessionStore;
    private readonly BootstrapConfig             _bootstrap;
    private readonly ILogger<VirtualizationHub>  _logger;

    public VirtualizationHub(
        IVSessionRegistry           registry,
        SidecarBrowserClientOptions sidecarOptions,
        ISpeculumConfigStore        configStore,
        IBrowserSessionStore        sessionStore,
        BootstrapConfig             bootstrap,
        ILogger<VirtualizationHub>  logger)
    {
        _registry       = registry;
        _sidecarOptions = sidecarOptions;
        _configStore    = configStore;
        _sessionStore   = sessionStore;
        _bootstrap      = bootstrap;
        _logger         = logger;
    }

    public async Task<string> StartSessionAsync(
        string clientUrl,
        int viewportWidth,
        int viewportHeight,
        string? clientToken)
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

        string resolvedClientToken;
        try
        {
            resolvedClientToken = ClientTokenNormalizer.Resolve(clientToken);
        }
        catch (ArgumentException ex)
        {
            throw new HubException(ex.Message);
        }

        var config     = _configStore.Current;
        var forwarding = config.Forwarding!;
        var subdomainOn = _configStore.IsSubdomainMirroringOperational;

        if (_registry.TryRemove(Context.ConnectionId, out var oldActive))
        {
            _logger.LogWarning(
                "Conexão {ConnectionId}: sessão anterior não encerrada — capturando e parando.",
                Context.ConnectionId);

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
        else if (_registry.TryCancelStarting(Context.ConnectionId, out var oldStarting))
        {
            _logger.LogWarning(
                "Conexão {ConnectionId}: startup anterior ainda em curso — cancelando.",
                Context.ConnectionId);
            _registry.ReleaseSlot();
            try { await oldStarting.StopAsync(); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Erro ao parar startup anterior.");
            }
        }

        if (!_registry.TryAcquireSlot(config.MaxSessions!.Value))
            throw new HubException("Limite de sessões simultâneas atingido.");

        VSession? session  = null;
        var promoted       = false;
        try
        {
            var browserSessionId = await _sessionStore.ResolveOrCreateSessionAsync(
                resolvedClientToken, Context.ConnectionAborted);

            var browserState = await _sessionStore.LoadStateAsync(browserSessionId, Context.ConnectionAborted);

            var initialUrl = InitialUrlBuilder.Build(
                forwarding,
                clientUrl,
                subdomainOn,
                _bootstrap.MotorPublicDomain);

            _logger.LogInformation(
                "Conexão {ConnectionId}: iniciando sessão em {InitialUrl} (sessionId={SessionPrefix}…)",
                Context.ConnectionId, initialUrl, browserSessionId[..Math.Min(8, browserSessionId.Length)]);

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
            };

            session = new VSession(_sidecarOptions, sessionSnapshot, _logger);
            session.PersistedSessionId = browserSessionId;
            _registry.TrackStarting(Context.ConnectionId, session);

            await session.StartAsync(Context.ConnectionAborted);

            if (!_registry.TryPromoteStarting(Context.ConnectionId, session))
            {
                _logger.LogInformation(
                    "Conexão {ConnectionId} cancelada durante startup — descartando sessão.",
                    Context.ConnectionId);
                throw new HubException("Sessão cancelada durante startup.");
            }

            promoted = true;
            session  = null;
        }
        catch (HubException)
        {
            throw;
        }
        catch (ArgumentException ex)
        {
            throw new HubException(ex.Message);
        }
        catch (OperationCanceledException) when (Context.ConnectionAborted.IsCancellationRequested)
        {
            _logger.LogInformation(
                "Startup cancelado para ConnectionId={ConnectionId}.",
                Context.ConnectionId);
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
                    cancelled = _registry.TryCancelStarting(Context.ConnectionId, out _);
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

        return resolvedClientToken;
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (_registry.TryCancelStarting(Context.ConnectionId, out var starting))
        {
            _registry.ReleaseSlot();
            try { await starting.StopAsync(); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "Erro ao parar sessão em startup na desconexão (ConnectionId={ConnectionId}).",
                    Context.ConnectionId);
            }
        }
        else if (_registry.TryRemove(Context.ConnectionId, out var session))
        {
            if (!string.IsNullOrWhiteSpace(session.PersistedSessionId))
            {
                try { await session.CaptureAndPersistAsync(session.PersistedSessionId!, _sessionStore); }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex,
                        "Erro ao persistir estado (ConnectionId={ConnectionId}).",
                        Context.ConnectionId);
                }
            }

            try { await session.StopAsync(); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "Erro ao parar sessão na desconexão (ConnectionId={ConnectionId}).",
                    Context.ConnectionId);
            }
        }

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
    {
        if (string.IsNullOrWhiteSpace(clientUrl))
            throw new HubException("URL de navegação é obrigatória.");

        var forwarding = _configStore.Current.Forwarding!;
        string targetUrl;
        try
        {
            targetUrl = InitialUrlBuilder.Build(
                forwarding,
                clientUrl,
                _configStore.IsSubdomainMirroringOperational,
                _bootstrap.MotorPublicDomain);
        }
        catch (ArgumentException ex)
        {
            throw new HubException(ex.Message);
        }

        return RequireSession().NavigateAsync(targetUrl);
    }

    public Task ResizeAsync(int width, int height)
        => RequireSession().ResizeAsync(width, height);

    private VSession RequireSession()
    {
        var session = _registry.Get(Context.ConnectionId);
        if (session is null)
            throw new HubException("Sessão não iniciada. Chame StartSessionAsync primeiro.");
        return session;
    }
}
