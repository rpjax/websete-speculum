namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>Abstração da conexão com o navegador virtual (ex: sidecar Node.js).</summary>
public interface IVirtualBrowserConnection
{
    Task StopAsync(CancellationToken ct = default);
}
