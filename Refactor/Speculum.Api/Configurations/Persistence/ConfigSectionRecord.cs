namespace Speculum.Api.Configurations.Persistence;

public sealed class ConfigSectionRecord
{
    public required string Key { get; set; }
    public string? ValueJson { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
