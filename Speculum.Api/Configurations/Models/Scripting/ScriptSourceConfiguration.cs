namespace Speculum.Api.Configurations.Models.Scripting;

public sealed class ScriptSourceConfiguration
{
    public ScriptSourceType SourceType { get; init; }
    public Guid? StoredScriptId { get; init; }
    public Uri? RemoteUrl { get; init; }
}
