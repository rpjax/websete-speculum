namespace Speculum.Api.Configurations.Models.Scripting;

public sealed class ScriptingConfiguration
{
    public IReadOnlyList<ScriptInjectionConfiguration> Injections { get; init; } = Array.Empty<ScriptInjectionConfiguration>();
}
