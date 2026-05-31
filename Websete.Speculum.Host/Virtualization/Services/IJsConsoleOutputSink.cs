namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Consome saídas do console JS — retransmite ao cliente downstream.
/// <br/>Fluxo: sessão → [sink] → cliente.
/// </summary>
public interface IJsConsoleOutputSink
{
    Task WriteConsoleOutputAsync(ConsoleOutputEvent outputEvent, CancellationToken ct = default);
}
