using System.Threading.Channels;
using Microsoft.AspNetCore.SignalR;
using Websete.Speculum.Host.Config.Runtime;
using Websete.Speculum.Host.Config.Store;
using Websete.Speculum.Host.Virtualization.Contracts;
using Websete.Speculum.Host.Virtualization.Models;
using Websete.Speculum.Host.Virtualization.Options;
using Websete.Speculum.Host.Virtualization.Persistence;

namespace Websete.Speculum.Host.Virtualization.Presentation;

public sealed class VirtualizationHub : Hub
{
    private readonly IVSessionRegistry           _registry;
    private readonly SidecarBrowserClientOptions _sidecarOptions;
    private readonly ISpeculumConfigStore        _configStore;
    private readonly IBrowserSnapshotStore       _snapshotStore;
    private readonly IProfileSnapshotMerger      _snapshotMerger;
    private readonly ILogger<VirtualizationHub>  _logger;

    public VirtualizationHub(
        IVSessionRegistry           registry,
        SidecarBrowserClientOptions sidecarOptions,
        ISpeculumConfigStore        configStore,
        IBrowserSnapshotStore       snapshotStore,
        IProfileSnapshotMerger      snapshotMerger,
        ILogger<VirtualizationHub>  logger)
    {
        _registry        = registry;
        _sidecarOptions  = sidecarOptions;
        _configStore     = configStore;
        _snapshotStore   = snapshotStore;
        _snapshotMerger  = snapshotMerger;
        _logger          = logger;
    }

    public async Task StartSessionAsync(string clientUrl, int viewportWidth, int viewportHeight)
    {
        if (string.IsNullOrWhiteSpace(clientUrl))
            throw new HubException("clientUrl é obrigatório.");

        if (!_configStore.IsOperational)
        {
            var missing = string.Join(", ", _configStore.MissingRequired);
            throw new HubException(
                $"Motor não configurado. Seções obrigatórias em falta: {missing}. " +
                "Configure via /api/admin/config e consulte /setup.");
        }

        var config     = _configStore.Current;
        var forwarding = config.Forwarding!;

        if (_registry.TryRemove(Context.ConnectionId, out var oldActive))
        {
            _logger.LogWarning(
                "Conexão {ConnectionId}: sessão anterior não encerrada — capturando e parando.",
                Context.ConnectionId);

            var cookieId = SessionCookieMiddleware.GetCookieId(Context.GetHttpContext());
            if (!string.IsNullOrWhiteSpace(cookieId))
            {
                try { await oldActive.CaptureAndPersistAsync(cookieId, _snapshotMerger); }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Erro ao persistir snapshot da sessão anterior.");
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
            var cookieId = SessionCookieMiddleware.GetCookieId(Context.GetHttpContext());
            var snapshot = !string.IsNullOrWhiteSpace(cookieId)
                ? await _snapshotStore.TryLoadAsync(cookieId)
                : null;

            string initialUrl;
            if (TryResolveSnapshotUrl(snapshot?.LastUrl, forwarding.Domains, out var restoredUrl))
                initialUrl = restoredUrl;
            else
                initialUrl = InitialUrlBuilder.Build(forwarding.Host, clientUrl);

            _logger.LogInformation(
                "Conexão {ConnectionId}: iniciando sessão em {InitialUrl} (cookie={HasCookie})",
                Context.ConnectionId, initialUrl, cookieId is not null);

            var (w, h) = ViewportDimensions.Normalize(viewportWidth, viewportHeight);

            var sessionSnapshot = new SessionConfigSnapshot
            {
                InitialUrl               = initialUrl,
                Width                    = w,
                Height                   = h,
                ProfileBlob              = snapshot?.ProfileBlob,
                Scripts                  = config.ResolvedScripts,
                JsBridgeEnabled          = config.JsBridgeEnabled,
                AllowedNavigationDomains = forwarding.Domains,
            };

            session = new VSession(_sidecarOptions, sessionSnapshot, _logger);
            session.CookieId = cookieId;
            _registry.TrackStarting(Context.ConnectionId, session);

            await session.StartAsync(Context.ConnectionAborted);

            if (!_registry.TryPromoteStarting(Context.ConnectionId, session))
            {
                _logger.LogInformation(
                    "Conexão {ConnectionId} cancelada durante startup — descartando sessão.",
                    Context.ConnectionId);
                return;
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
            var cookieId = SessionCookieMiddleware.GetCookieId(Context.GetHttpContext());
            if (!string.IsNullOrWhiteSpace(cookieId))
            {
                try { await session.CaptureAndPersistAsync(cookieId, _snapshotMerger); }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex,
                        "Erro ao persistir snapshot (ConnectionId={ConnectionId}).",
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

    public Task OpenUserInputChannel(ChannelReader<UserInput> channelReader)
        => RequireSession().ConsumeUserInputAsync(channelReader);

    public Task OpenConsoleInputChannel(ChannelReader<ConsoleInput> channelReader)
        => RequireSession().ConsumeConsoleInputAsync(channelReader);

    public Task NavigateAsync(string url)
        => RequireSession().NavigateAsync(url);

    public Task ResizeAsync(int width, int height)
        => RequireSession().ResizeAsync(width, height);

    private VSession RequireSession()
    {
        var session = _registry.Get(Context.ConnectionId);
        if (session is null)
            throw new HubException("Sessão não iniciada. Chame StartSessionAsync primeiro.");
        return session;
    }

    private static bool TryResolveSnapshotUrl(
        string? lastUrl,
        string[] allowedDomains,
        out string initialUrl)
    {
        initialUrl = "";
        if (string.IsNullOrWhiteSpace(lastUrl)
            || !Uri.TryCreate(lastUrl, UriKind.Absolute, out var uri)
            || uri.Scheme is not "http" and not "https")
        {
            return false;
        }

        if (!DomainMatcher.MatchesAny(uri.Host, allowedDomains))
            return false;

        initialUrl = lastUrl;
        return true;
    }
}
