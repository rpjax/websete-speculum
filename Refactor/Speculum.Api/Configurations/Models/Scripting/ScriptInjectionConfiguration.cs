using Speculum.Api.Configurations.Models.Patterns;

namespace Speculum.Api.Configurations.Models.Scripting;

public sealed class ScriptInjectionConfiguration
{
    public ScriptSourceConfiguration Source { get; init; } = new();
    public ScriptInjectionPosition Position { get; init; }
    public ScriptExecutionType ExecutionType { get; init; }
    public IReadOnlyList<UrlMatchRule> TargetRules { get; init; } = Array.Empty<UrlMatchRule>();
}
