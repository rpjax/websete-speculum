namespace Speculum.Api.Config.Persistence;

public sealed class ConfigSectionEntity
{
    public string Key { get; set; } = "";
    public string? ValueJson { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
