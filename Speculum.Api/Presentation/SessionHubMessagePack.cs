using MessagePack;
using MessagePack.Resolvers;

namespace Speculum.Api.Presentation;

/// <summary>
/// Shared MessagePack options for the session hub — camelCase map keys for the
/// React <c>@microsoft/signalr-protocol-msgpack</c> client.
/// </summary>
public static class SessionHubMessagePack
{
    public static MessagePackSerializerOptions Options { get; } =
        MessagePackSerializerOptions.Standard
            .WithResolver(CompositeResolver.Create(
                StandardResolver.Instance,
                ContractlessStandardResolver.Instance))
            .WithSecurity(MessagePackSecurity.UntrustedData);
}
