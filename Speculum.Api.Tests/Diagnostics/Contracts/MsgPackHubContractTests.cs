using MessagePack;
using MessagePack.Resolvers;
using Speculum.Api.Motor.Live;
using Speculum.Api.Motor.Live.Models;

namespace Speculum.Api.Tests;

/// <summary>
/// Hub MessagePack must bind the same camelCase keys the React client sends/reads.
/// Known-red until hotfix: ContractlessStandardResolver is case-sensitive on property names.
/// </summary>
public sealed class MsgPackHubContractTests
{
    private static readonly MessagePackSerializerOptions Options =
        MessagePackSerializerOptions.Standard.WithResolver(ContractlessStandardResolver.Instance);

    [Fact]
    public void SessionIdentity_deserializes_js_camelCase_clientToken()
    {
        // Mirrors MotorConnection.invokeStartSession: { clientToken, correlationId }
        var jsMap = new Dictionary<string, object?>
        {
            ["clientToken"] = "abcdef0123456789abcdef0123456789",
            ["correlationId"] = "actcorrelationid0000000000000001",
        };

        var bytes = MessagePackSerializer.Serialize(jsMap, Options);
        var identity = MessagePackSerializer.Deserialize<SessionIdentity>(bytes, Options);

        Assert.False(
            string.IsNullOrWhiteSpace(identity.ClientToken),
            "BUG A trap: MessagePack dropped camelCase clientToken — web StartSession cannot rebind. " +
            "Fix in hotfix plan (camelCase protocol / Key attributes).");
        Assert.Equal("abcdef0123456789abcdef0123456789", identity.ClientToken);
    }

    [Fact]
    public void SessionStatus_roundtrip_exposes_camelCase_url_for_js_client()
    {
        var status = new SessionStatus
        {
            TabCount = 1,
            Url = "https://speculum.test/nav/b?_w7s_nso=x",
            Resizing = false,
            Width = 1280,
            Height = 720,
            Fps = 1,
            UptimeMs = 1000,
            SessionId = "deadbeef",
            JsBridgeEnabled = true,
        };

        var bytes = MessagePackSerializer.Serialize(status, Options);
        // JS reads object keys as produced on the wire — enumerate MessagePack map keys.
        var reader = new MessagePackReader(bytes);
        Assert.Equal(MessagePackType.Map, reader.NextMessagePackType);
        var count = reader.ReadMapHeader();
        var keys = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < count; i++)
        {
            keys.Add(reader.ReadString()!);
            reader.Skip();
        }

        Assert.True(
            keys.Contains("url"),
            "BUG B trap: SessionStatus MsgPack keys are not camelCase (got: "
            + string.Join(", ", keys.OrderBy(k => k))
            + "). MotorEngine reads status.url and never syncClientLocation. Fix in hotfix plan.");
        Assert.Contains("sessionId", keys);
        Assert.Contains("jsBridgeEnabled", keys);
    }

    [Fact]
    public void SessionIdentity_pascalCase_still_binds_for_csharp_act_clients()
    {
        var identity = new SessionIdentity
        {
            ClientToken = "abcdef0123456789abcdef0123456789",
            CorrelationId = "actcorrelationid0000000000000002",
        };
        var bytes = MessagePackSerializer.Serialize(identity, Options);
        var round = MessagePackSerializer.Deserialize<SessionIdentity>(bytes, Options);
        Assert.Equal(identity.ClientToken, round.ClientToken);
    }
}
