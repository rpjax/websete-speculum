using MessagePack;
using MessagePack.Resolvers;

namespace Speculum.Api.Motor.Live;

/// <summary>
/// Shared MessagePack options for /vhub — camelCase map keys so the React
/// <c>@microsoft/signalr-protocol-msgpack</c> client matches C# DTOs.
/// Attributed hub models use <see cref="StandardResolver"/>; unmarked types
/// fall through to contractless (same default SignalR used before).
/// </summary>
public static class MotorHubMessagePack
{
    public static MessagePackSerializerOptions Options { get; } =
        MessagePackSerializerOptions.Standard
            .WithResolver(CompositeResolver.Create(
                StandardResolver.Instance,
                ContractlessStandardResolver.Instance))
            .WithSecurity(MessagePackSecurity.UntrustedData);
}
