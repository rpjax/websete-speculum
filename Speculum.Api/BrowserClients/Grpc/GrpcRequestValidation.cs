using Aidan.Core.Patterns;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.BrowserClients.Grpc;

/// <summary>Strict request validation for the ISessionConnection ↔ gRPC boundary.</summary>
internal static class GrpcRequestValidation
{
    public static IResult<(int Width, int Height)> ValidateLaunch(
        SessionConfig? configuration,
        ViewportPolicy policy)
    {
        ArgumentNullException.ThrowIfNull(policy);

        if (configuration?.Resolution is not { } resolution)
        {
            return Result<(int, int)>.Failure("Launch requires SessionConfig.Resolution");
        }

        if (configuration.Device is null)
        {
            return Result<(int, int)>.Failure("Launch requires SessionConfig.Device");
        }

        if (configuration.ClientEnvironment is not { } environment
            || string.IsNullOrWhiteSpace(environment.Locale)
            || string.IsNullOrWhiteSpace(environment.Language)
            || string.IsNullOrWhiteSpace(environment.TimeZoneId)
            || !ClientEnvironmentPolicy.IsSupportedColorScheme(
                environment.ColorScheme))
        {
            return Result<(int, int)>.Failure(
                "Launch requires a complete SessionConfig.ClientEnvironment");
        }

        if (environment.Geolocation is { } geolocation
            && (!double.IsFinite(geolocation.Latitude)
                || !double.IsFinite(geolocation.Longitude)
                || !double.IsFinite(geolocation.Accuracy)
                || geolocation.Latitude is < -90 or > 90
                || geolocation.Longitude is < -180 or > 180
                || geolocation.Accuracy < 0))
        {
            return Result<(int, int)>.Failure("Launch geolocation is invalid");
        }

        return ValidateViewport(resolution.Width, resolution.Height, policy);
    }

    public static IResult ValidateNavigate(string? url)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            return Result.Failure("Navigate requires a non-empty URL");
        }

        return Result.Success();
    }

    public static IResult ValidateResize(
        int width,
        int height,
        ViewportPolicy policy)
    {
        ArgumentNullException.ThrowIfNull(policy);
        var viewport = ValidateViewport(width, height, policy);
        return viewport.IsFailure
            ? Result.Failure(viewport.Errors.ToArray())
            : Result.Success();
    }

    public static IResult ValidateProbe(DiagProbeRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.Ops is not { Count: > 0 })
        {
            return Result.Failure("Probe requires at least one op");
        }

        return Result.Success();
    }

    public static IResult ValidateEvaluate(string? code)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            return Result.Failure("Evaluate requires non-empty code");
        }

        return Result.Success();
    }

    public static bool HasExplicitDevice(DeviceProfile device)
    {
        ArgumentNullException.ThrowIfNull(device);
        return device.Mobile
            || device.Touch
            || device.MaxTouchPoints > 0
            || !string.IsNullOrWhiteSpace(device.UserAgentProfile)
            || !string.IsNullOrWhiteSpace(device.ScreenOrientation)
            || Math.Abs(device.DeviceScaleFactor - 1d) > double.Epsilon;
    }

    private static IResult<(int Width, int Height)> ValidateViewport(
        int width,
        int height,
        ViewportPolicy policy)
    {
        if (width < policy.Minimum.Width || height < policy.Minimum.Height)
        {
            return Result<(int, int)>.Failure(
                $"Viewport {width}×{height} below minimum {policy.Minimum.Width}×{policy.Minimum.Height}");
        }

        if (width > policy.Maximum.Width || height > policy.Maximum.Height)
        {
            return Result<(int, int)>.Failure(
                $"Viewport {width}×{height} above maximum {policy.Maximum.Width}×{policy.Maximum.Height}");
        }

        return Result<(int, int)>.Success((width, height));
    }
}
