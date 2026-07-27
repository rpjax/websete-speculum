namespace Speculum.Api.Configurations.Persistence;

public sealed class MotorMetadataRecord
{
    public required string Key { get; set; }
    public string? Value { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
