namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Consome frames de vídeo H.264 — retransmite ao cliente downstream.
/// <br/>Fluxo: sessão → [sink] → cliente.
/// </summary>
public interface IFrameSink
{
    Task WriteFrameAsync(Frame frame, CancellationToken ct = default);
}
