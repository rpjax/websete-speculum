namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>Abstração da conexão com o cliente downstream (ex: WebSocket).</summary>
public interface IDownstreamConnection
{
    Task CloseAsync(CancellationToken ct = default);
}
