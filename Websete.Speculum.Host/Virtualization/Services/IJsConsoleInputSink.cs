namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Consome comandos <c>evaljs</c> — encaminha ao motor JS do navegador virtual.
/// <br/>Fluxo: sessão → [sink] → navegador virtual.
/// </summary>
public interface IJsConsoleInputSink
{
    Task WriteConsoleInputAsync(ConsoleInputEvent inputEvent, CancellationToken ct = default);
}
