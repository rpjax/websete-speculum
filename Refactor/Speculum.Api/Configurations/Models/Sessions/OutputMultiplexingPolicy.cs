namespace Speculum.Api.Configurations.Models.Sessions;

public sealed class OutputMultiplexingPolicy
{
    /// <summary>
    /// Default <see cref="OutputDeliveryPolicy.Broadcast"/> matches multi-pipe live sessions
    /// (Attach notification pipe + WebTransport frame pipe). Exclusive would starve frames.
    /// </summary>
    public OutputDeliveryPolicy Delivery { get; init; } = OutputDeliveryPolicy.Broadcast;

    public OutputOwnershipPolicy Ownership { get; init; }
}
