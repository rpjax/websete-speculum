using System.Threading.Channels;
using Microsoft.AspNetCore.SignalR;
using Websete.Speculum.Host.Virtualization.Contracts;
using Websete.Speculum.Host.Virtualization.Models;
using Websete.Speculum.Host.Virtualization.Options;

namespace Websete.Speculum.Host.Virtualization.Presentation;

/// <summary>
/// Único ponto de entrada da aplicação.
///
/// O hub é transitório (uma instância por método invocado), por isso o estado
/// da sessão é gerido externamente no <see cref="IVSessionRegistry"/> singleton,
/// indexado por <see cref="HubCallerContext.ConnectionId"/>.
/// </summary>
public sealed class VirtualizationHub : Hub
{
    private readonly IVSessionRegistry              _registry;
    private readonly SidecarBrowserClientOptions     _sidecarOptions;
    private readonly VirtualBrowserConnectionOptions _connectionOptions;
    private readonly ILogger<VirtualizationHub>      _logger;

    public VirtualizationHub(
        IVSessionRegistry              registry,
        SidecarBrowserClientOptions     sidecarOptions,
        VirtualBrowserConnectionOptions connectionOptions,
        ILogger<VirtualizationHub>      logger)
    {
        _registry          = registry;
        _sidecarOptions    = sidecarOptions;
        _connectionOptions = connectionOptions;
        _logger            = logger;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Cria e inicia a sessão de virtualização para esta conexão.
    /// Caso já exista uma sessão anterior (re-connect sem desconexão limpa),
    /// ela é parada antes de criar a nova.
    /// </summary>
    public async Task StartSessionAsync()
    {
        if (_registry.TryRemove(Context.ConnectionId, out var old))
        {
            _logger.LogWarning("Conexão {ConnectionId}: sessão anterior não encerrada — parando.", Context.ConnectionId);
            await old.StopAsync();
        }

        var session = new VSession(_sidecarOptions, _connectionOptions, _logger);
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

    // ── Output streams (server → client) ─────────────────────────────────────

    public ChannelReader<Frame> OpenFrameChannel()
        => RequireSession().GetFrameReader();

    public ChannelReader<ConsoleOutput> OpenConsoleOutputChannel()
        => RequireSession().GetConsoleOutputReader();

    // ── Input streams (client → server) ──────────────────────────────────────
    //
    // IMPORTANT: These methods MUST return Task (not void).
    // SignalR's DefaultHubDispatcher casts the return value to Task and awaits it.
    // A void/null return is treated as an immediately-completed Task, which causes
    // SignalR to complete the Channel<T>.Writer right away — ReadAllAsync on the
    // reader then yields nothing and the input pump exits without processing any events.
    // Returning the live pump Task keeps the streaming invocation open for the
    // full session lifetime (until the client completes the Subject or disconnects).

    public Task OpenUserInputChannel(ChannelReader<UserInput> channelReader)
        => RequireSession().ConsumeUserInputAsync(channelReader);

    public Task OpenConsoleInputChannel(ChannelReader<ConsoleInput> channelReader)
        => RequireSession().ConsumeConsoleInputAsync(channelReader);

    // ── Browser control ───────────────────────────────────────────────────────

    public Task NavigateAsync(string url)
        => RequireSession().NavigateAsync(url);

    public Task ResizeAsync(int width, int height)
        => RequireSession().ResizeAsync(width, height);

    // ── Private ───────────────────────────────────────────────────────────────

    private VSession RequireSession()
    {
        var session = _registry.Get(Context.ConnectionId);
        if (session is null)
            throw new HubException("Sessão não iniciada. Chame StartSessionAsync primeiro.");
        return session;
    }
}
