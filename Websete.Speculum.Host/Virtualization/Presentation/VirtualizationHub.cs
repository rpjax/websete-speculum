using System.Threading.Channels;
using Microsoft.AspNetCore.SignalR;
using Websete.Speculum.Host.Config.Runtime;
using Websete.Speculum.Host.Config.Store;
using Websete.Speculum.Host.Virtualization.Contracts;
using Websete.Speculum.Host.Virtualization.Models;
using Websete.Speculum.Host.Virtualization.Options;

namespace Websete.Speculum.Host.Virtualization.Presentation;

public sealed class VirtualizationHub : Hub
{
    private readonly IVSessionRegistry           _registry;
    private readonly SidecarBrowserClientOptions _sidecarOptions;
    private readonly ISpeculumConfigStore        _configStore;
    private readonly ILogger<VirtualizationHub>  _logger;

    public VirtualizationHub(
        IVSessionRegistry           registry,
        SidecarBrowserClientOptions sidecarOptions,
        ISpeculumConfigStore        configStore,
        ILogger<VirtualizationHub>  logger)
    {
        _registry       = registry;
        _sidecarOptions = sidecarOptions;
        _configStore    = configStore;
        _logger         = logger;
    }

    public async Task StartSessionAsync(string clientUrl)
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

        var config = _configStore.Current;
        var forwarding = config.Forwarding!;

        if (_registry.ActiveCount >= config.MaxSessions!.Value)
            throw new HubException("Limite de sessões simultâneas atingido.");

        if (_registry.TryRemove(Context.ConnectionId, out var old))
        {
            _logger.LogWarning(
                "Conexão {ConnectionId}: sessão anterior não encerrada — parando.",
                Context.ConnectionId);
            await old.StopAsync();
        }

        string initialUrl;
        try
        {
            initialUrl = InitialUrlBuilder.Build(forwarding.Host, clientUrl);
        }
        catch (ArgumentException ex)
        {
            throw new HubException(ex.Message);
        }

        _logger.LogInformation(
            "Conexão {ConnectionId}: iniciando sessão em {InitialUrl}",
            Context.ConnectionId, initialUrl);

        var snapshot = new SessionConfigSnapshot
        {
            InitialUrl                = initialUrl,
            Scripts                   = config.ResolvedScripts,
            JsBridgeEnabled           = config.JsBridgeEnabled,
            AllowedNavigationDomains  = forwarding.Domains,
        };

        var session = new VSession(_sidecarOptions, snapshot, _logger);
        _registry.Register(Context.ConnectionId, session);
        await session.StartAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (_registry.TryRemove(Context.ConnectionId, out var session))
        {
            try   { await session.StopAsync(); }
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
}
