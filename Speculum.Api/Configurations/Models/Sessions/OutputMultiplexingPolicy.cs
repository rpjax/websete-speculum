namespace Speculum.Api.Configurations.Models.Sessions;

public sealed class OutputMultiplexingPolicy
{
    /// <summary>
    /// Default <see cref="OutputDeliveryPolicy.Broadcast"/> delivers each outbound event to every
    /// open stream of that kind. Exclusive selects one stream of that kind via Ownership.
    /// </summary>
    public OutputDeliveryPolicy Delivery { get; init; } = OutputDeliveryPolicy.Broadcast;

    public OutputOwnershipPolicy Ownership { get; init; }
}
