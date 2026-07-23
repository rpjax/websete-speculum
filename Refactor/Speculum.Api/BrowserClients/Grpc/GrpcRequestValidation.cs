using Aidan.Core.Patterns;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.BrowserClients.Grpc;

/// <summary>Strict request validation for the ISessionConnection ↔ gRPC boundary.</summary>
internal static class GrpcRequestValidation
{
    private const int MinWidth = 100;
    private const int MinHeight = 100;
    private const int MaxWidth = 4096;
    private const int MaxHeight = 2160;

    public static IResult<(int Width, int Height)> ValidateLaunch(SessionConfig? configuration)
    {
        if (configuration?.Resolution is not { } resolution)
        {
            return Result<(int, int)>.Failure("Launch requires SessionConfig.Resolution");
        }

        return ValidateViewport(resolution.Width, resolution.Height);
    }

    public static IResult ValidateNavigate(string? url)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            return Result.Failure("Navigate requires a non-empty URL");
        }

        return Result.Success();
    }

    public static IResult ValidateResize(int width, int height)
    {
        var viewport = ValidateViewport(width, height);
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

    private static IResult<(int Width, int Height)> ValidateViewport(int width, int height)
    {
        if (width < MinWidth || height < MinHeight)
        {
            return Result<(int, int)>.Failure(
                $"Viewport {width}×{height} below minimum {MinWidth}×{MinHeight}");
        }

        if (width > MaxWidth || height > MaxHeight)
        {
            return Result<(int, int)>.Failure(
                $"Viewport {width}×{height} above maximum {MaxWidth}×{MaxHeight}");
        }

        return Result<(int, int)>.Success((width, height));
    }
}
