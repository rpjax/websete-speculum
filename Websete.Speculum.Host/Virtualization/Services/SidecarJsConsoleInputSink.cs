using System.Text.Json;
using Websete.Speculum.Browser;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Implementação de <see cref="IJsConsoleInputSink"/> que serializa comandos
/// <c>evaljs</c> e os encaminha ao sidecar via
/// <see cref="SidecarClient.SendInputAsync"/>.
/// </summary>
public sealed class SidecarJsConsoleInputSink : IJsConsoleInputSink
{
    private readonly SidecarClient _client;

    public SidecarJsConsoleInputSink(SidecarClient client) => _client = client;

    /// <summary>
    /// Serializa o evento para o formato de protocolo do sidecar:
    /// <c>{"type":"evaljs","id":N,"code":"..."}</c>.
    /// </summary>
    public Task WriteConsoleInputAsync(ConsoleInputEvent inputEvent, CancellationToken ct = default)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            type = "evaljs",
            id   = inputEvent.Id,
            code = inputEvent.Code,
        });

        return _client.SendInputAsync(payload.AsMemory(), ct);
    }
}
