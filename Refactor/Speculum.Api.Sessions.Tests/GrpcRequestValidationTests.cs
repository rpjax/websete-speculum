using Speculum.Api.BrowserClients.Grpc;
using Speculum.Api.BrowserSessions.Models;

namespace Speculum.Api.Sessions.Tests;

public sealed class GrpcRequestValidationTests
{
    [Fact]
    public void ValidateLaunch_NullConfiguration_Fails()
    {
        var result = GrpcRequestValidation.ValidateLaunch(null);
        Assert.True(result.IsFailure);
    }

    [Fact]
    public void ValidateLaunch_MissingResolution_Fails()
    {
        var result = GrpcRequestValidation.ValidateLaunch(new SessionConfig());
        Assert.True(result.IsFailure);
    }

    [Fact]
    public void ValidateLaunch_ValidResolution_Succeeds()
    {
        var result = GrpcRequestValidation.ValidateLaunch(new SessionConfig
        {
            Resolution = new ScreenResolution { Width = 1280, Height = 720 },
        });

        Assert.True(result.IsSuccess);
        Assert.Equal((1280, 720), result.Value);
    }

    [Fact]
    public void ValidateNavigate_EmptyUrl_Fails()
    {
        Assert.True(GrpcRequestValidation.ValidateNavigate("").IsFailure);
        Assert.True(GrpcRequestValidation.ValidateNavigate("   ").IsFailure);
    }

    [Fact]
    public void ValidateResize_OutOfRange_Fails()
    {
        Assert.True(GrpcRequestValidation.ValidateResize(50, 600).IsFailure);
        Assert.True(GrpcRequestValidation.ValidateResize(1280, 5000).IsFailure);
    }

    [Fact]
    public void ValidateProbe_EmptyOps_Fails()
    {
        var result = GrpcRequestValidation.ValidateProbe(new DiagProbeRequest { Ops = [] });
        Assert.True(result.IsFailure);
    }

    [Fact]
    public void ValidateEvaluate_EmptyCode_Fails()
    {
        Assert.True(GrpcRequestValidation.ValidateEvaluate(null).IsFailure);
        Assert.True(GrpcRequestValidation.ValidateEvaluate("").IsFailure);
    }
}
