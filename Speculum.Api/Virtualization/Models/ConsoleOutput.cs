namespace Speculum.Api.Virtualization.Models;

/// <summary>
/// Saída de controlo produzida pelo navegador virtual:
/// <c>MSG_URL</c> (0x04), <c>MSG_CONSOLE</c> (0x05) ou
/// <c>MSG_EVAL_RESULT</c> (0x06), já codificados no protocolo binário.
/// </summary>
public sealed class ConsoleOutput
{
    /// <summary>
    /// Frame binário já codificado, pronto para relay ao cliente sem
    /// re-serialização.
    /// </summary>
    public ReadOnlyMemory<byte> Data { get; init; }
}
