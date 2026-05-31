using Websete.Speculum.Browser;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Implementação de <see cref="IInputSink"/> que encaminha eventos de input
/// ao sidecar Node.js via <see cref="SidecarClient.SendInputAsync"/>.
/// </summary>
/// <remarks>
/// <see cref="InputEvent.Payload"/> deve conter o JSON completo do evento
/// já serializado pelo cliente — ex: <c>{"type":"mousemove","x":640,"y":360}</c>.
/// O payload é codificado como UTF-8 e enviado ao sidecar sem re-serialização.
/// </remarks>
public sealed class SidecarInputSink : IInputSink
{
    private readonly SidecarClient _client;

    public SidecarInputSink(SidecarClient client) => _client = client;

    public Task WriteInputEventAsync(InputEvent inputEvent, CancellationToken ct = default)
        => _client.SendInputAsync(
            System.Text.Encoding.UTF8.GetBytes(inputEvent.Payload).AsMemory(), ct);
}
