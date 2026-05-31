namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Consome eventos de input — encaminha ao navegador virtual.
/// <br/>Fluxo: sessão → [sink] → navegador virtual.
/// </summary>
public interface IInputSink
{
    Task WriteInputEventAsync(InputEvent inputEvent, CancellationToken ct = default);
}
