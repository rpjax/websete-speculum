using Speculum.Api.BrowserClients.Grpc;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Tests;

public sealed class GrpcRequestValidationTests
{
    [Fact]
    public void TryParseInputEvent_MalformedPayload_IsRejected()
    {
        var result = GrpcSessionMappers.TryParseInputEvent(
            Guid.NewGuid(),
            new UserInput
            {
                Type = "mousemove",
                Payload = """{"type":"mousemove","x":"invalid"}""",
            },
            out var input);

        Assert.False(result);
        Assert.Null(input);
    }

    [Fact]
    public void ConsoleAndEvalMappers_ReturnTypedEnvelopes()
    {
        var console = GrpcSessionMappers.ConsoleEventToOutput(new Speculum.Api.Sidecar.V1.ConsoleEvent
        {
            Level = 2,
            Text = "message",
        });
        var evaluation = GrpcSessionMappers.EvalResultToOutput(
            17,
            new Speculum.Api.Sidecar.V1.EvaluateResult
            {
                Ok = true,
                Value = "42",
            });

        Assert.Equal(ConsoleOutputKind.Console, console.Kind);
        Assert.Equal(2, console.Level);
        Assert.Equal("message", console.Text);
        Assert.Equal(ConsoleOutputKind.EvalResult, evaluation.Kind);
        Assert.Equal(17, evaluation.RequestId);
        Assert.True(evaluation.Ok);
        Assert.Equal("42", evaluation.Value);
    }

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
    public void ValidateLaunch_CompleteConfiguration_Succeeds()
    {
        var result = GrpcRequestValidation.ValidateLaunch(new SessionConfig
        {
            Resolution = new ScreenResolution { Width = 1280, Height = 720 },
            Device = new DeviceProfile
            {
                DeviceScaleFactor = 1,
                UserAgentProfile = "desktop",
                ScreenOrientation = "landscapePrimary",
            },
            ClientEnvironment = new ClientEnvironment
            {
                Locale = "en-US",
                Language = "en-US",
                TimeZoneId = "America/New_York",
                ColorScheme = "dark",
            },
        });

        Assert.True(result.IsSuccess);
        Assert.Equal((1280, 720), result.Value);
    }

    [Fact]
    public void ValidateLaunch_UnsupportedColorScheme_Fails()
    {
        var result = GrpcRequestValidation.ValidateLaunch(new SessionConfig
        {
            Resolution = new ScreenResolution { Width = 800, Height = 600 },
            Device = new DeviceProfile
            {
                DeviceScaleFactor = 1,
                UserAgentProfile = "desktop",
                ScreenOrientation = "landscapePrimary",
            },
            ClientEnvironment = new ClientEnvironment
            {
                Locale = "en-US",
                Language = "en-US",
                TimeZoneId = "America/New_York",
                ColorScheme = "sepia",
            },
        });

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void ValidateLaunch_InvalidGeolocation_Fails()
    {
        var result = GrpcRequestValidation.ValidateLaunch(new SessionConfig
        {
            Resolution = new ScreenResolution { Width = 800, Height = 600 },
            Device = new DeviceProfile
            {
                DeviceScaleFactor = 1,
                UserAgentProfile = "desktop",
                ScreenOrientation = "landscapePrimary",
            },
            ClientEnvironment = new ClientEnvironment
            {
                Locale = "en-US",
                Language = "en-US",
                TimeZoneId = "America/New_York",
                ColorScheme = "dark",
                Geolocation = new Geolocation
                {
                    Latitude = 200,
                    Longitude = -46.63,
                    Accuracy = 10,
                },
            },
        });

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void ValidateNavigate_EmptyUrl_Fails()
    {
        Assert.True(GrpcRequestValidation.ValidateNavigate("").IsFailure);
        Assert.True(GrpcRequestValidation.ValidateNavigate("   ").IsFailure);
    }

    [Fact]
    public void ToLaunchRequest_MapsCompleteClientEnvironment()
    {
        var configuration = new SessionConfig
        {
            Resolution = new ScreenResolution { Width = 800, Height = 600 },
            Device = new DeviceProfile
            {
                DeviceScaleFactor = 1,
                UserAgentProfile = "desktop",
                ScreenOrientation = "landscapePrimary",
            },
            ClientEnvironment = new ClientEnvironment
            {
                Locale = "pt-BR",
                Language = "pt-BR",
                TimeZoneId = "America/Sao_Paulo",
                ColorScheme = "light",
                Geolocation = new Geolocation
                {
                    Latitude = -23.55,
                    Longitude = -46.63,
                    Accuracy = 10,
                },
            },
        };

        var request = GrpcSessionMappers.ToLaunchRequest(
            Guid.NewGuid(),
            800,
            600,
            configuration);

        Assert.Equal("pt-BR", request.Locale);
        Assert.Equal("America/Sao_Paulo", request.TimezoneId);
        Assert.NotNull(request.Geolocation);
        Assert.Equal(10, request.Geolocation.Accuracy);
    }

    [Fact]
    public void ValidateResize_OutOfRange_Fails()
    {
        var policy = SessionsTestHarness.Sessions().ViewportPolicy;

        Assert.True(GrpcRequestValidation.ValidateResize(50, 600, policy).IsFailure);
        Assert.True(GrpcRequestValidation.ValidateResize(1280, 5000, policy).IsFailure);
    }

    [Fact]
    public void ValidateResize_UsesConfiguredViewportPolicy()
    {
        var policy = new Configurations.Models.Sessions.ViewportPolicy
        {
            Minimum = new Configurations.Models.Sessions.ScreenResolution
            {
                Width = 300,
                Height = 200,
            },
            Default = new Configurations.Models.Sessions.ScreenResolution
            {
                Width = 800,
                Height = 600,
            },
            Maximum = new Configurations.Models.Sessions.ScreenResolution
            {
                Width = 1600,
                Height = 1200,
            },
        };

        Assert.True(GrpcRequestValidation.ValidateResize(299, 600, policy).IsFailure);
        Assert.True(GrpcRequestValidation.ValidateResize(1601, 600, policy).IsFailure);
        Assert.True(GrpcRequestValidation.ValidateResize(800, 600, policy).IsSuccess);
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
