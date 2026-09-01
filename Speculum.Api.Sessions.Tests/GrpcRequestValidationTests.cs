using Speculum.Api.BrowserClients.Grpc;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Tests;

public sealed class GrpcRequestValidationTests
{
    [Fact]
    public void TryParseInputEvent_MalformedPayload_IsRejected()
    {
        var result = GrpcSessionMappers.TryParseInputEvent(
            Guid.NewGuid(),
            new VideoStreamingInput
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
        var result = GrpcRequestValidation.ValidateLaunch(
            null,
            SessionsTestHarness.Sessions().ViewportPolicy);
        Assert.True(result.IsFailure);
    }

    [Fact]
    public void ValidateLaunch_MissingResolution_Fails()
    {
        var result = GrpcRequestValidation.ValidateLaunch(
            new SessionConfig(),
            SessionsTestHarness.Sessions().ViewportPolicy);
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
        }, SessionsTestHarness.Sessions().ViewportPolicy);

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
        }, SessionsTestHarness.Sessions().ViewportPolicy);

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
        }, SessionsTestHarness.Sessions().ViewportPolicy);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void ValidateLaunch_OutsideViewportPolicy_Fails()
    {
        var policy = new Configurations.Models.Sessions.ViewportPolicy
        {
            Minimum = new Configurations.Models.Sessions.ScreenResolution { Width = 300, Height = 200 },
            Default = new Configurations.Models.Sessions.ScreenResolution { Width = 800, Height = 600 },
            Maximum = new Configurations.Models.Sessions.ScreenResolution { Width = 1600, Height = 1200 },
        };
        var result = GrpcRequestValidation.ValidateLaunch(new SessionConfig
        {
            Resolution = new ScreenResolution { Width = 2000, Height = 600 },
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
        }, policy);

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

        var engine = SessionsTestHarness.Engine("www.target.test");
        var request = GrpcSessionMappers.ToLaunchVideoStreamingRequest(
            Guid.NewGuid(),
            800,
            600,
            configuration,
            SessionsTestHarness.Sessions().ViewportPolicy,
            "speculum.test",
            engine);

        Assert.Equal("pt-BR", request.Locale);
        Assert.Equal("America/Sao_Paulo", request.TimezoneId);
        Assert.NotNull(request.Geolocation);
        Assert.Equal(10, request.Geolocation.Accuracy);
        Assert.Equal(100, request.MinWidth);
        Assert.Equal(100, request.MinHeight);
        Assert.Equal(4096, request.DisplayWidth);
        Assert.Equal(2160, request.DisplayHeight);
        Assert.Equal(2, request.ScreencastMaxEncodeScale);

        var capped = GrpcSessionMappers.ToLaunchVideoStreamingRequest(
            Guid.NewGuid(),
            800,
            600,
            configuration,
            SessionsTestHarness.Sessions().ViewportPolicy,
            "speculum.test",
            engine,
            screencastMaxEncodeScale: 1);
        Assert.Equal(1, capped.ScreencastMaxEncodeScale);
        Assert.Equal(1, GrpcSessionMappers.ClampScreencastMaxEncodeScale(0.5));
        Assert.Equal(2, GrpcSessionMappers.ClampScreencastMaxEncodeScale(3));
        Assert.Equal(8192, GrpcSessionMappers.ClampFrameQueueCapacity(0));
        Assert.Equal(4096, GrpcSessionMappers.ClampFrameQueueCapacity(4096));

        var domLaunch = GrpcSessionMappers.ToLaunchPageProjectionRequest(
            Guid.NewGuid(),
            800,
            600,
            configuration,
            SessionsTestHarness.Sessions().ViewportPolicy,
            "speculum.test",
            engine,
            frameQueueCapacity: 4096);
        Assert.Equal(4096, domLaunch.FrameQueueCapacity);
        Assert.NotNull(domLaunch.NavigationPolicy);
        Assert.Equal("speculum.test", domLaunch.NavigationPolicy.RequestHost);
    }

    [Fact]
    public void SessionsConfigurationValidator_ScreencastMaxEncodeScale_Bounds()
    {
        var validator = new Configurations.Models.Sessions.SessionsConfigurationValidator();

        Assert.False(validator.Validate(null, SessionsWithEncodeScale(1)).Failed);
        Assert.False(validator.Validate(null, SessionsWithEncodeScale(2)).Failed);
        Assert.True(validator.Validate(null, SessionsWithEncodeScale(0.5)).Failed);
        Assert.True(validator.Validate(null, SessionsWithEncodeScale(3)).Failed);
    }

    [Fact]
    public void SessionsConfigurationValidator_MirrorMode_DefinedValues()
    {
        var validator = new Configurations.Models.Sessions.SessionsConfigurationValidator();

        Assert.False(validator.Validate(null, SessionsWithMirrorMode(
            Configurations.Models.Sessions.MirrorMode.VideoStreaming)).Failed);
        Assert.False(validator.Validate(null, SessionsWithMirrorMode(
            Configurations.Models.Sessions.MirrorMode.PageProjection)).Failed);
        Assert.True(validator.Validate(null, SessionsWithMirrorMode(
            (Configurations.Models.Sessions.MirrorMode)99)).Failed);
    }

    private static Configurations.Models.Sessions.SessionsConfiguration SessionsWithEncodeScale(
        double maxEncodeScale)
    {
        var baseline = SessionsTestHarness.Sessions();
        return new Configurations.Models.Sessions.SessionsConfiguration
        {
            DetachedSessionTimeout = baseline.DetachedSessionTimeout,
            IsJsBridgeEnabled = baseline.IsJsBridgeEnabled,
            DataStreamTransport = baseline.DataStreamTransport,
            MirrorMode = baseline.MirrorMode,
            ViewportPolicy = baseline.ViewportPolicy,
            ClientEnvironmentPolicy = baseline.ClientEnvironmentPolicy,
            DeviceEmulationPolicy = baseline.DeviceEmulationPolicy,
            InputMultiplexingPolicy = baseline.InputMultiplexingPolicy,
            OutputMultiplexingPolicy = baseline.OutputMultiplexingPolicy,
            ScreencastPolicy = new Configurations.Models.Sessions.ScreencastPolicy
            {
                MaxEncodeScale = maxEncodeScale,
            },
        };
    }

    private static Configurations.Models.Sessions.SessionsConfiguration SessionsWithMirrorMode(
        Configurations.Models.Sessions.MirrorMode mirrorMode)
    {
        var baseline = SessionsTestHarness.Sessions();
        return new Configurations.Models.Sessions.SessionsConfiguration
        {
            DetachedSessionTimeout = baseline.DetachedSessionTimeout,
            IsJsBridgeEnabled = baseline.IsJsBridgeEnabled,
            DataStreamTransport = baseline.DataStreamTransport,
            MirrorMode = mirrorMode,
            ViewportPolicy = baseline.ViewportPolicy,
            ClientEnvironmentPolicy = baseline.ClientEnvironmentPolicy,
            DeviceEmulationPolicy = baseline.DeviceEmulationPolicy,
            InputMultiplexingPolicy = baseline.InputMultiplexingPolicy,
            OutputMultiplexingPolicy = baseline.OutputMultiplexingPolicy,
            ScreencastPolicy = baseline.ScreencastPolicy,
        };
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

    [Fact]
    public void VideoStreamingInput_MessagePack_RoundTripsCamelCaseMapFromJsClient()
    {
        // Mirrors @msgpack/msgpack encode({ type, payload }) on the web data plane.
        var options = Speculum.Api.Presentation.SessionHubMessagePack.Options;
        var map = new Dictionary<string, object>
        {
            ["type"] = "mousedown",
            ["payload"] = """{"type":"mousedown","x":640,"y":360,"button":0}""",
        };
        var bytes = MessagePack.MessagePackSerializer.Serialize(map, options);
        var decoded = MessagePack.MessagePackSerializer.Deserialize<VideoStreamingInput>(bytes, options);

        Assert.Equal("mousedown", decoded.Type);
        Assert.Contains("640", decoded.Payload);
        Assert.True(
            GrpcSessionMappers.TryParseInputEvent(Guid.NewGuid(), decoded, out var input)
            && input?.MouseDown is not null);
    }

    [Fact]
    public void VideoStreamingInput_MessagePack_RoundTripsTraceIdAndClientTimestamp()
    {
        var options = Speculum.Api.Presentation.SessionHubMessagePack.Options;
        var map = new Dictionary<string, object>
        {
            ["type"] = "mousemove",
            ["payload"] = """{"type":"mousemove","x":1,"y":2}""",
            ["traceId"] = "abc123deadbeef00",
            ["clientTimestampMs"] = 1_700_000_000_000L,
        };
        var bytes = MessagePack.MessagePackSerializer.Serialize(map, options);
        var decoded = MessagePack.MessagePackSerializer.Deserialize<VideoStreamingInput>(bytes, options);

        Assert.Equal("mousemove", decoded.Type);
        Assert.Equal("abc123deadbeef00", decoded.TraceId);
        Assert.Equal(1_700_000_000_000L, decoded.ClientTimestampMs);
    }

    [Fact]
    public void PageProjectionIntent_MessagePack_RoundTripsContextId()
    {
        var options = Speculum.Api.Presentation.SessionHubMessagePack.Options;
        var map = new Dictionary<string, object>
        {
            ["generation"] = 2L,
            ["type"] = "mousedown",
            ["targetId"] = 42U,
            ["contextId"] = 2U,
            ["payload"] = "{}",
        };
        var bytes = MessagePack.MessagePackSerializer.Serialize(map, options);
        var decoded = MessagePack.MessagePackSerializer.Deserialize<PageProjectionIntent>(bytes, options);

        Assert.Equal(2U, decoded.ContextId);
        Assert.Equal(42U, decoded.TargetId);
        Assert.True(
            GrpcSessionMappers.TryParseDomInputEvent(Guid.NewGuid(), decoded, out var input)
            && input is not null);
        Assert.Equal(2U, input!.ContextId);
    }

    [Fact]
    public void PageProjectionIntent_MessagePack_RoundTripsTraceId()
    {
        var options = Speculum.Api.Presentation.SessionHubMessagePack.Options;
        var map = new Dictionary<string, object>
        {
            ["generation"] = 7L,
            ["type"] = "mousedown",
            ["anchor"] = "a1",
            ["timestampClient"] = 12.5,
            ["traceId"] = "domtrace01",
            ["payload"] = """{"x":10,"y":20,"button":0}""",
        };
        var bytes = MessagePack.MessagePackSerializer.Serialize(map, options);
        var decoded = MessagePack.MessagePackSerializer.Deserialize<PageProjectionIntent>(bytes, options);

        Assert.Equal(7L, decoded.Generation);
        Assert.Equal("mousedown", decoded.Type);
        Assert.Equal("a1", decoded.Anchor);
        Assert.Equal(12.5, decoded.TimestampClient);
        Assert.Equal("domtrace01", decoded.TraceId);
        Assert.True(
            GrpcSessionMappers.TryParseDomInputEvent(Guid.NewGuid(), decoded, out var input)
            && input is not null);
        Assert.Equal("domtrace01", decoded.TraceId);
    }
}
