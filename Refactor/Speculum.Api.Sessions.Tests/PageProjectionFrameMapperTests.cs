using System.Text;
using Google.Protobuf;
using Speculum.Api.BrowserClients.Grpc;
using Speculum.Api.Sidecar.V1;

namespace Speculum.Api.Sessions.Tests;

/// <summary>
/// PP-WIRE-1: <see cref="GrpcSessionMappers.ToPageProjectionFrame"/> must relay opaque
/// redesign binary frames (empty plane/operation) without JSON-parsing <c>Body</c>, while
/// still decoding the legacy V1 JSON-body scheme.
/// </summary>
public sealed class PageProjectionFrameMapperTests
{
    [Fact]
    public void BinaryFrame_EmptyPlaneAndOperation_RelaysBodyOpaquely()
    {
        // Not valid JSON — proves the mapper never attempts JsonDocument.Parse on it.
        var binaryPayload = new byte[] { 0x00, 0x01, 0xFF, 0x7B, 0x3A, 0x22 };
        var frame = new PageProjectionFrame
        {
            Sequence = 42,
            Generation = 3,
            Plane = "",
            Operation = "",
            TimestampMs = 1_700_000_000_000,
            Body = ByteString.CopyFrom(binaryPayload),
            PartIndex = 1,
            PartCount = 3,
            Flags = 0b11,
            Version = 2,
        };

        var diff = GrpcSessionMappers.ToPageProjectionFrame(frame);

        Assert.NotNull(diff);
        Assert.Equal("", diff!.Plane);
        Assert.Equal("", diff.Operation);
        Assert.Equal(binaryPayload, diff.Body);
        Assert.Equal(42, diff.Sequence);
        Assert.Equal(3, diff.Generation);
        Assert.Equal(1_700_000_000_000, diff.Timestamp);
        Assert.Equal(1u, diff.PartIndex);
        Assert.Equal(3u, diff.PartCount);
        Assert.Equal(0b11u, diff.Flags);
        Assert.Equal(2u, diff.Version);
        Assert.Null(diff.Document);
        Assert.Null(diff.ChildList);
    }

    [Fact]
    public void BinaryFrame_JsonLookingBodyWithEmptyPlaneOperation_IsStillRelayedOpaquely()
    {
        // Even a body that happens to look like JSON must not be parsed on the V2 path —
        // plane/operation empty is the sole discriminator (PP-WIRE-1).
        var jsonLookingPayload = Encoding.UTF8.GetBytes("""{"root":{"tag":"div"}}""");
        var frame = new PageProjectionFrame
        {
            Sequence = 5,
            Generation = 1,
            Plane = "",
            Operation = "",
            TimestampMs = 1,
            Body = ByteString.CopyFrom(jsonLookingPayload),
            PartIndex = 0,
            PartCount = 0,
            Flags = 0,
            Version = 2,
        };

        var diff = GrpcSessionMappers.ToPageProjectionFrame(frame);

        Assert.NotNull(diff);
        Assert.Equal(jsonLookingPayload, diff!.Body);
        Assert.Equal(1u, diff.PartCount); // PartCount 0 defaults to 1 (unsplit frame).
        Assert.Null(diff.Document);
    }

    [Fact]
    public void BinaryFrame_VersionZero_DefaultsToOne()
    {
        var frame = new PageProjectionFrame
        {
            Sequence = 1,
            Generation = 1,
            Plane = "",
            Operation = "",
            TimestampMs = 1,
            Body = ByteString.CopyFrom(new byte[] { 0x01 }),
            Version = 0,
        };

        var diff = GrpcSessionMappers.ToPageProjectionFrame(frame);

        Assert.NotNull(diff);
        Assert.Equal(1u, diff!.Version);
    }

    [Fact]
    public void EmptyEnvelope_NoBodyAndEmptyPlaneOperation_ReturnsNull()
    {
        var frame = new PageProjectionFrame
        {
            Sequence = 1,
            Generation = 1,
            Plane = "",
            Operation = "",
            TimestampMs = 1,
            Body = ByteString.Empty,
        };

        Assert.Null(GrpcSessionMappers.ToPageProjectionFrame(frame));
    }

    [Fact]
    public void PartialEnvelope_OnlyPlaneSet_ReturnsNull()
    {
        var frame = new PageProjectionFrame
        {
            Sequence = 1,
            Generation = 1,
            Plane = "dom",
            Operation = "",
            TimestampMs = 1,
            Body = ByteString.CopyFrom(new byte[] { 0x01 }),
        };

        Assert.Null(GrpcSessionMappers.ToPageProjectionFrame(frame));
    }

    [Fact]
    public void LegacyV1Frame_ScrollViewport_StillDecodesJsonPayload()
    {
        var frame = new PageProjectionFrame
        {
            Sequence = 9,
            Generation = 1,
            Plane = "dom",
            Operation = "scrollViewport",
            TimestampMs = 123,
            Body = ByteString.CopyFromUtf8("""{"scrollX":10.5,"scrollY":20.25}"""),
        };

        var diff = GrpcSessionMappers.ToPageProjectionFrame(frame);

        Assert.NotNull(diff);
        Assert.Equal("dom", diff!.Plane);
        Assert.Equal("scrollViewport", diff.Operation);
        Assert.NotNull(diff.ScrollViewport);
        Assert.Equal(10.5, diff.ScrollViewport!.ScrollX);
        Assert.Equal(20.25, diff.ScrollViewport.ScrollY);
        Assert.Null(diff.Body);
        Assert.Equal(1u, diff.Version);
    }

    [Fact]
    public void LegacyV1Frame_CorruptJsonBody_ReturnsNullDecodeError()
    {
        var frame = new PageProjectionFrame
        {
            Sequence = 1,
            Generation = 1,
            Plane = "dom",
            Operation = "scrollViewport",
            TimestampMs = 1,
            Body = ByteString.CopyFromUtf8("not-json"),
        };

        Assert.Null(GrpcSessionMappers.ToPageProjectionFrame(frame));
    }

    [Fact]
    public void LegacyV1Frame_UnknownPlane_ReturnsNull()
    {
        var frame = new PageProjectionFrame
        {
            Sequence = 1,
            Generation = 1,
            Plane = "unknown",
            Operation = "document",
            TimestampMs = 1,
            Body = ByteString.CopyFromUtf8("""{"root":{"tag":"div"}}"""),
        };

        Assert.Null(GrpcSessionMappers.ToPageProjectionFrame(frame));
    }
}
