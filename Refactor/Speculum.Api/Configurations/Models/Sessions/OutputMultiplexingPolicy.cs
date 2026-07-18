namespace Speculum.Api.Configurations.Models.Sessions;

public sealed class OutputMultiplexingPolicy
{
    public OutputDeliveryPolicy Delivery { get; init; }
    public OutputOwnershipPolicy Ownership { get; init; }
}
