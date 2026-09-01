using System.Text;
using Google.Protobuf;
using Speculum.Api.BrowserClients.Grpc;
using Speculum.Api.Sidecar.V1;

namespace Speculum.Api.Sessions.Tests;

/// <summary>
/// PP-WIRE-1 / M4: <see cref="GrpcSessionMappers.ToPageProjectionFrame"/> relays opaque
/// envelopes without parsing <c>Body</c>.
/// </summary>
public sealed class PageProjectionFrameMapperTests
{
    [Fact]
    public void BinaryFrame_RelaysBodyOpaquely()
    {
        // Not valid JSON — proves the mapper never attempts JsonDocument.Parse on it.
        var binaryPayload = new byte[] { 0x00, 0x01, 0xFF, 0x7B, 0x3A, 0x22 };
        var frame = new PageProjectionFrame
        {
            Sequence = 42,
            Generation = 3,
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
    }

    [Fact]
    public void BinaryFrame_JsonLookingBody_IsStillRelayedOpaquely()
    {
        var jsonLookingPayload = Encoding.UTF8.GetBytes("""{"root":{"tag":"div"}}""");
        var frame = new PageProjectionFrame
        {
            Sequence = 5,
            Generation = 1,
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
        Assert.Equal(1u, diff.PartCount);
    }

    [Fact]
    public void BinaryFrame_VersionZero_DefaultsToOne()
    {
        var frame = new PageProjectionFrame
        {
            Sequence = 1,
            Generation = 1,
            TimestampMs = 1,
            Body = ByteString.CopyFrom(new byte[] { 0x01 }),
            Version = 0,
        };

        var diff = GrpcSessionMappers.ToPageProjectionFrame(frame);

        Assert.NotNull(diff);
        Assert.Equal(1u, diff!.Version);
    }

    [Fact]
    public void EmptyEnvelope_NoBody_ReturnsNull()
    {
        var frame = new PageProjectionFrame
        {
            Sequence = 1,
            Generation = 1,
            TimestampMs = 1,
            Body = ByteString.Empty,
        };

        Assert.Null(GrpcSessionMappers.ToPageProjectionFrame(frame));
    }

    [Fact]
    public void RemovedV1HeaderFields_RelayBodyWithoutParsing()
    {
        var body = Encoding.UTF8.GetBytes("""{"scrollX":10.5,"scrollY":20.25}""");
        var frame = new PageProjectionFrame
        {
            Sequence = 9,
            Generation = 1,
            TimestampMs = 123,
            Body = ByteString.CopyFrom(body),
        };

        var diff = GrpcSessionMappers.ToPageProjectionFrame(frame);

        Assert.NotNull(diff);
        Assert.Equal("", diff!.Plane);
        Assert.Equal("", diff.Operation);
        Assert.Equal(body, diff.Body);
        Assert.Equal(1u, diff.Version);
    }
}
