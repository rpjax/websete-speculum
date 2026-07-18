using MessagePack;

namespace Speculum.Api.BrowserSessions.Models;

/// <summary>
/// Comando <c>evaljs</c> originado no cliente e destinado ao motor JS do
/// navegador virtual.
/// </summary>
[MessagePackObject]
public sealed class ConsoleInput
{
    /// <summary>Correlação com o <c>MSG_EVAL_RESULT</c> de resposta.</summary>
    [Key("id")]
    public int Id { get; init; }

    /// <summary>Código JavaScript a ser executado no contexto da página.</summary>
    [Key("code")]
    public required string Code { get; init; }
}
