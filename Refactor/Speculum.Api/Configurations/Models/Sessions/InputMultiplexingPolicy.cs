namespace Speculum.Api.Configurations.Models.Sessions;

public sealed class InputMultiplexingPolicy
{
    public InputAccessPolicy Access { get; init; }
    public InputOwnershipPolicy Ownership { get; init; }
    public InputSchedulingPolicy Scheduling { get; init; }
}
