namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Saída produzida pelo navegador virtual: <c>MSG_CONSOLE</c> (log/warn/error)
/// ou <c>MSG_EVAL_RESULT</c>, já codificados no protocolo binário.
/// </summary>
public sealed class ConsoleOutputEvent
{
    /// <summary>
    /// Frame binário já codificado, pronto para relay ao cliente sem
    /// re-serialização.
    /// </summary>
    public ReadOnlyMemory<byte> Data { get; init; }
}
