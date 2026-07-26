using Grpc.Core;
using Speculum.Api.BrowserClients.Grpc;

namespace Speculum.Api.Sessions.Tests;

public sealed class GrpcSessionConnectionRetryTests
{
    [Theory]
    [InlineData(StatusCode.Unavailable, "transient", true)]
    [InlineData(StatusCode.Unknown, "ResponseEnded", true)]
    [InlineData(StatusCode.Internal, "The HTTP/2 connection faulted: ended prematurely", true)]
    [InlineData(StatusCode.Unknown, "Unavailable", true)]
    [InlineData(StatusCode.NotFound, "session not found", false)]
    [InlineData(StatusCode.InvalidArgument, "bad url", false)]
    [InlineData(StatusCode.Internal, "something else", false)]
    public void ShouldRetry_MatchesTransientTransportOnly(
        StatusCode statusCode,
        string detail,
        bool expected)
    {
        Assert.Equal(expected, GrpcSessionConnection.ShouldRetry(statusCode, detail));
    }

    [Fact]
    public void IsSessionGone_NotFoundOrDetail()
    {
        Assert.True(GrpcSessionConnection.IsSessionGone(
            new RpcException(new Status(StatusCode.NotFound, "session not found: abc"))));
        Assert.True(GrpcSessionConnection.IsSessionGone(
            new RpcException(new Status(StatusCode.FailedPrecondition, "session not found: abc"))));
        Assert.False(GrpcSessionConnection.IsSessionGone(
            new RpcException(new Status(StatusCode.Unavailable, "connection refused"))));
    }
}
