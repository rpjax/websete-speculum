using MessagePack;
using Speculum.Api.Motor.Live;
using Speculum.Api.Motor.Live.Models;

namespace Speculum.Api.Tests;

/// <summary>
/// Hub MessagePack must bind the same camelCase keys the React client sends/reads.
/// </summary>
public sealed class MsgPackHubContractTests
{
    private static readonly MessagePackSerializerOptions Options = MotorHubMessagePack.Options;

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

        Assert.False(string.IsNullOrWhiteSpace(identity.ClientToken));
        Assert.Equal("abcdef0123456789abcdef0123456789", identity.ClientToken);
        Assert.Equal("actcorrelationid0000000000000001", identity.CorrelationId);
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
        var reader = new MessagePackReader(bytes);
        Assert.Equal(MessagePackType.Map, reader.NextMessagePackType);
        var count = reader.ReadMapHeader();
        var keys = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < count; i++)
        {
            keys.Add(reader.ReadString()!);
            reader.Skip();
        }

        Assert.Contains("url", keys);
        Assert.Contains("sessionId", keys);
        Assert.Contains("jsBridgeEnabled", keys);
        Assert.DoesNotContain("Url", keys);
    }

    [Fact]
    public void SessionIdentity_object_roundtrip_preserves_clientToken()
    {
        var identity = new SessionIdentity
        {
            ClientToken = "abcdef0123456789abcdef0123456789",
            CorrelationId = "actcorrelationid0000000000000002",
        };
        var bytes = MessagePackSerializer.Serialize(identity, Options);
        var round = MessagePackSerializer.Deserialize<SessionIdentity>(bytes, Options);
        Assert.Equal(identity.ClientToken, round.ClientToken);
        Assert.Equal(identity.CorrelationId, round.CorrelationId);
    }
}
