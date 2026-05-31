using Websete.Speculum.Browser;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Implementação de <see cref="IVirtualBrowserConnection"/> sobre o
/// <see cref="SidecarClient"/> Node.js.
/// </summary>
public sealed class SidecarVirtualBrowserConnection : IVirtualBrowserConnection
{
    private readonly SidecarClient _client;

    public SidecarVirtualBrowserConnection(SidecarClient client) => _client = client;

    /// <summary>
    /// Cancela o loop de receive, drena os canais internos, envia o frame de
    /// fechamento WebSocket ao sidecar e libera todos os recursos do
    /// <see cref="SidecarClient"/>.
    /// </summary>
    public async Task StopAsync(CancellationToken ct = default)
        => await _client.DisposeAsync();
}
