namespace Speculum.Api.Motor.Live.Models;

/// <summary>
/// Comando <c>evaljs</c> originado no cliente e destinado ao motor JS do
/// navegador virtual.
/// </summary>
public sealed class ConsoleInput
{
    /// <summary>Correlação com o <c>MSG_EVAL_RESULT</c> de resposta.</summary>
    public int Id { get; init; }

    /// <summary>Código JavaScript a ser executado no contexto da página.</summary>
    public required string Code { get; init; }
}
