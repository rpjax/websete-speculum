using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Sidecar;

namespace Speculum.Api.Sessions.Tests;

public sealed class SidecarOptionsValidatorTests
{
    private readonly SidecarOptionsValidator _validator = new();

    [Fact]
    public void Default_MaxGrpcMessageBytes_Is64MiB()
    {
        Assert.Equal(64 * 1024 * 1024, SidecarOptions.DefaultMaxGrpcMessageBytes);
        Assert.Equal(SidecarOptions.DefaultMaxGrpcMessageBytes, new SidecarOptions().MaxGrpcMessageBytes);
    }

    [Fact]
    public void Validate_AcceptsDefaultOptions()
    {
        var result = _validator.Validate(null, new SidecarOptions());
        Assert.Equal(ValidateOptionsResult.Success, result);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(1024)] // below 1 MiB
    [InlineData(257 * 1024 * 1024)] // above 256 MiB
    public void Validate_RejectsOutOfRangeMaxGrpcMessageBytes(int bytes)
    {
        var options = new SidecarOptions { MaxGrpcMessageBytes = bytes };
        var result = _validator.Validate(null, options);
        Assert.True(result.Failed);
        Assert.Contains(
            result.Failures!,
            f => f.Contains("MaxGrpcMessageBytes", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(1 * 1024 * 1024)]
    [InlineData(64 * 1024 * 1024)]
    [InlineData(256 * 1024 * 1024)]
    public void Validate_AcceptsBoundaryMaxGrpcMessageBytes(int bytes)
    {
        var options = new SidecarOptions { MaxGrpcMessageBytes = bytes };
        var result = _validator.Validate(null, options);
        Assert.Equal(ValidateOptionsResult.Success, result);
    }
}
