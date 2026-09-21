using Speculum.Api.BrowserClients.Gecko;
using Speculum.Supervisor.Wire;

namespace Speculum.Api.Sessions.Tests;

public sealed class GeckoWireTests
{
    [Fact]
    public void ClassifyDestination_Empty_IsXhr()
    {
        Assert.Equal(13, GeckoAssetWire.ClassifyDestination(""));
        Assert.Equal(13, GeckoAssetWire.ClassifyDestination(null));
        Assert.Equal(1, GeckoAssetWire.ClassifyDestination("image"));
        Assert.Equal(0, GeckoAssetWire.ClassifyDestination("unknown-dest"));
    }

    [Fact]
    public void EncodeRequest_IsKindAssetEnvelope()
    {
        var envelope = GeckoAssetWire.EncodeRequest(7, 1, "https://cdn.test/a.png", "");
        Assert.True(Envelope.TryReadComplete(envelope, EnvelopeKind.Asset, out var ctx, out var len));
        Assert.Equal(0u, ctx);
        Assert.True(len > 0);

        GeckoAssetWire.StampContext(envelope, 3);
        Assert.True(Envelope.TryReadComplete(envelope, EnvelopeKind.Asset, out var stamped, out _));
        Assert.Equal(3u, stamped);
    }

    [Fact]
    public void FramePeek_ReadsMagicPayload()
    {
        var body = MakePpBody(contextId: 4, generation: 9, sequence: 11);
        var frame = GeckoFramePeek.ToFrame(body, 1);
        Assert.NotNull(frame);
        Assert.Equal(4u, frame!.ContextId);
        Assert.Equal(9L, frame.Generation);
        Assert.Equal(11L, frame.Sequence);
        Assert.Same(body, frame.Body);
    }

    /// <summary>
    /// Contrato do Lab / BrowserLink: frame PP no WS do consumidor é carga crua (sem Kind 0x01).
    /// Exigir envelope aqui é o hop que deixava Live branco com Lab armado.
    /// </summary>
    [Fact]
    public void ConsumerWire_RawPpFrame_MatchesLabContract()
    {
        var raw = MakePpBody(contextId: 1, generation: 2, sequence: 3);

        // O path quebrado do Live (só EnvelopeKind.Frame) rejeita a carga crua.
        Assert.False(Envelope.TryReadComplete(raw, EnvelopeKind.Frame, out _, out _));

        Assert.True(GeckoConsumerWire.TryClassify(raw, out var kind, out var ctx, out var payload));
        Assert.Equal(GeckoConsumerWire.Kind.ProjectionFrame, kind);
        Assert.Equal(0u, ctx);
        Assert.Equal(raw.Length, payload.Count);

        var body = payload.ToArray();
        var frame = GeckoFramePeek.ToFrame(body, ctx);
        Assert.NotNull(frame);
        Assert.Equal(1u, frame!.ContextId);
        Assert.Equal(2L, frame.Generation);
        Assert.Equal(3L, frame.Sequence);
    }

    [Fact]
    public void ConsumerWire_WrappedFrameEnvelope_StillAccepted()
    {
        var inner = MakePpBody(contextId: 7, generation: 1, sequence: 5);
        var wrapped = new byte[Envelope.HeaderBytes + inner.Length];
        Envelope.WriteHeader(wrapped, EnvelopeKind.Frame, contextId: 9, length: inner.Length);
        Buffer.BlockCopy(inner, 0, wrapped, Envelope.HeaderBytes, inner.Length);

        Assert.True(GeckoConsumerWire.TryClassify(wrapped, out var kind, out var ctx, out var payload));
        Assert.Equal(GeckoConsumerWire.Kind.ProjectionFrame, kind);
        Assert.Equal(9u, ctx);
        Assert.Equal(inner.Length, payload.Count);

        var frame = GeckoFramePeek.ToFrame(payload.ToArray(), ctx);
        Assert.NotNull(frame);
        Assert.Equal(7u, frame!.ContextId);
        Assert.Equal(5L, frame.Sequence);
    }

    [Fact]
    public void ConsumerWire_AssetEnvelope_NotTreatedAsProjection()
    {
        var envelope = GeckoAssetWire.EncodeRequest(1, 1, "https://cdn.test/x.png", "");
        Assert.True(GeckoConsumerWire.TryClassify(envelope, out var kind, out _, out _));
        Assert.Equal(GeckoConsumerWire.Kind.Asset, kind);
    }

    [Fact]
    public void IntentEncoder_Down_MatchesLabGoldenAbi()
    {
        // Golden from gecko-engine/tests/abi/encode-input.test.ts
        var want = Convert.FromHexString("08010b0000000100000001050000000080008000");
        var intent = new Speculum.Api.Sessions.Models.PageProjectionIntent
        {
            Type = "down",
            ContextId = 1,
            TargetId = 5,
            Payload = """{"localX":0.5,"localY":0.5,"button":"left"}""",
        };
        var got = GeckoIntentEncoder.Encode(11, intent);
        Assert.NotNull(got);
        Assert.Equal(Convert.ToHexString(want), Convert.ToHexString(got!));
    }

    private static byte[] MakePpBody(uint contextId, uint generation, uint sequence)
    {
        var body = new byte[32];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt16LittleEndian(body, 0x5050);
        body[2] = 2;
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(body.AsSpan(4), contextId);
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(body.AsSpan(8), generation);
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(body.AsSpan(12), sequence);
        System.Buffers.Binary.BinaryPrimitives.WriteUInt16LittleEndian(body.AsSpan(18), 1);
        return body;
    }
}
