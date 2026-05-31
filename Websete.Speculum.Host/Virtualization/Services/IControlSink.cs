namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Consome eventos de controle — retransmite ao cliente downstream.
/// <br/>Fluxo: sessão → [sink] → cliente.
/// </summary>
public interface IControlSink
{
    Task WriteControlEventAsync(ControlEvent controlEvent, CancellationToken ct = default);
}
