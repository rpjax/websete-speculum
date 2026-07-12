namespace Speculum.Api.Config.Runtime;

public sealed class SnapshotPolicyOptions
{
    public int TtlDays { get; init; } = 30;
}
