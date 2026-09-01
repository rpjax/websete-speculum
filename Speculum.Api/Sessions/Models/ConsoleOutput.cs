using MessagePack;

namespace Speculum.Api.Sessions.Models;

public enum ConsoleOutputKind
{
    Console = 1,
    EvalResult = 2,
}

/// <summary>Typed console/eval output from the virtual browser.</summary>
[MessagePackObject]
public sealed class ConsoleOutput
{
    [Key("kind")]
    public ConsoleOutputKind Kind { get; init; }

    [Key("level")]
    public int? Level { get; init; }

    [Key("text")]
    public string? Text { get; init; }

    [Key("requestId")]
    public int? RequestId { get; init; }

    [Key("ok")]
    public bool? Ok { get; init; }

    [Key("value")]
    public string? Value { get; init; }

    [Key("error")]
    public string? Error { get; init; }
}
