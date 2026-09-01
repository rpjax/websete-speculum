using System.Linq;
using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Sessions;

namespace Speculum.Api.Configurations.Models.Sessions;

public sealed class SessionsConfigurationValidator : IValidateOptions<SessionsConfiguration>
{
    public ValidateOptionsResult Validate(string? name, SessionsConfiguration options)
    {
        if (IsEmpty(options))
            return ValidateOptionsResult.Success;

        if (options.DetachedSessionTimeout <= TimeSpan.Zero)
        {
            return ValidateOptionsResult.Fail(
                "Sessions.DetachedSessionTimeout must be greater than zero.");
        }

        if (!Enum.IsDefined(options.DataStreamTransport))
        {
            return ValidateOptionsResult.Fail(
                "Sessions.DataStreamTransport must be webTransport or webSocket.");
        }

        if (!Enum.IsDefined(options.MirrorMode))
        {
            return ValidateOptionsResult.Fail(
                "Sessions.MirrorMode must be videoStreaming or pageProjection.");
        }

        if (options.FrameQueueCapacity < 64
            || options.FrameQueueCapacity > 65_536)
        {
            return ValidateOptionsResult.Fail(
                "Sessions.FrameQueueCapacity must be in [64, 65536].");
        }

        if (!IsValidPageProjectionOptions(options.PageProjection, out var pageProjectionError))
        {
            return ValidateOptionsResult.Fail(pageProjectionError);
        }

        var viewport = options.ViewportPolicy;
        if (!IsPositive(viewport.Minimum)
            || !IsPositive(viewport.Default)
            || !IsPositive(viewport.Maximum)
            || viewport.Minimum.Width > viewport.Default.Width
            || viewport.Minimum.Height > viewport.Default.Height
            || viewport.Default.Width > viewport.Maximum.Width
            || viewport.Default.Height > viewport.Maximum.Height)
        {
            return ValidateOptionsResult.Fail(
                "Sessions.ViewportPolicy must satisfy 0 < Minimum <= Default <= Maximum.");
        }

        var environment = options.ClientEnvironmentPolicy;
        if (string.IsNullOrWhiteSpace(environment.DefaultLocale)
            || string.IsNullOrWhiteSpace(environment.DefaultLanguage)
            || string.IsNullOrWhiteSpace(environment.DefaultTimeZoneId)
            || !ClientEnvironmentPolicy.IsSupportedColorScheme(
                environment.DefaultColorScheme))
        {
            return ValidateOptionsResult.Fail(
                "Sessions.ClientEnvironmentPolicy defaults are required and DefaultColorScheme must be light, dark, or no-preference.");
        }

        var device = options.DeviceEmulationPolicy;
        if (!double.IsFinite(device.MinDeviceScaleFactor)
            || !double.IsFinite(device.MaxDeviceScaleFactor)
            || device.MinDeviceScaleFactor <= 0
            || device.MinDeviceScaleFactor > device.MaxDeviceScaleFactor
            || device.MaxTouchPoints < 0
            || device.DefaultTouchPointsWhenTouch < 0
            || device.DefaultTouchPointsWhenTouch > device.MaxTouchPoints
            || !double.IsFinite(device.Default.DeviceScaleFactor)
            || device.Default.DeviceScaleFactor < device.MinDeviceScaleFactor
            || device.Default.DeviceScaleFactor > device.MaxDeviceScaleFactor
            || device.Default.MaxTouchPoints < 0
            || device.Default.MaxTouchPoints > device.MaxTouchPoints
            || string.IsNullOrWhiteSpace(device.Default.UserAgentProfile)
            || string.IsNullOrWhiteSpace(device.Default.ScreenOrientation)
            || string.IsNullOrWhiteSpace(device.DesktopUserAgentProfile)
            || string.IsNullOrWhiteSpace(device.MobileUserAgentProfile)
            || (!device.Default.UserAgentProfile.Equals(
                    device.DesktopUserAgentProfile,
                    StringComparison.OrdinalIgnoreCase)
                && !device.Default.UserAgentProfile.Equals(
                    device.MobileUserAgentProfile,
                    StringComparison.OrdinalIgnoreCase)
                && !device.Default.UserAgentProfile.Equals(
                    string.IsNullOrWhiteSpace(device.TabletUserAgentProfile)
                        ? "tablet"
                        : device.TabletUserAgentProfile,
                    StringComparison.OrdinalIgnoreCase)
                && !device.Default.UserAgentProfile.Equals("phone", StringComparison.OrdinalIgnoreCase)
                && !device.Default.UserAgentProfile.Equals("pc", StringComparison.OrdinalIgnoreCase)
                && !device.Default.UserAgentProfile.Equals("tablet", StringComparison.OrdinalIgnoreCase)))
        {
            return ValidateOptionsResult.Fail(
                "Sessions.DeviceEmulationPolicy is incomplete or has invalid bounds.");
        }

        var screencast = options.ScreencastPolicy;
        if (!double.IsFinite(screencast.MaxEncodeScale)
            || screencast.MaxEncodeScale < 1
            || screencast.MaxEncodeScale > 2)
        {
            return ValidateOptionsResult.Fail(
                "Sessions.ScreencastPolicy.MaxEncodeScale must be a finite number in [1, 2].");
        }

        return ValidateOptionsResult.Success;
    }

    private static bool IsEmpty(SessionsConfiguration options)
    {
        var viewport = options.ViewportPolicy;
        return options.DetachedSessionTimeout <= TimeSpan.Zero
            && viewport.Minimum.Width == 0
            && viewport.Minimum.Height == 0
            && viewport.Default.Width == 0
            && viewport.Default.Height == 0
            && viewport.Maximum.Width == 0
            && viewport.Maximum.Height == 0
            && string.IsNullOrWhiteSpace(options.ClientEnvironmentPolicy.DefaultLocale);
    }

    private static bool IsPositive(ScreenResolution resolution)
        => resolution.Width > 0 && resolution.Height > 0;

    /// <summary>
    /// Rejects §5.16 values that would stall frame emission indefinitely. This is the
    /// engine-redesign replacement for the old coalesce-knob validation: there is no
    /// "wait forever" knob left to misconfigure, only rates and byte caps that must stay
    /// strictly positive so the clock, the rate ladder and the establish stream always progress.
    /// </summary>
    private static bool IsValidPageProjectionOptions(PageProjectionOptions options, out string error)
    {
        if (options.FrameRateHz <= 0)
        {
            error = "Sessions.PageProjection.FrameRateHz must be greater than zero.";
            return false;
        }

        if (options.FrameRateLadder.Count == 0 || options.FrameRateLadder.Any(hz => hz <= 0))
        {
            error = "Sessions.PageProjection.FrameRateLadder must be non-empty and every step must be greater than zero.";
            return false;
        }

        if (options.HiddenRateHz <= 0)
        {
            error = "Sessions.PageProjection.HiddenRateHz must be greater than zero — zero would stall a hidden tab forever.";
            return false;
        }

        if (options.RateRecoverMs < 0)
        {
            error = "Sessions.PageProjection.RateRecoverMs must not be negative.";
            return false;
        }

        if (options.FrameStallMs <= 0)
        {
            error = "Sessions.PageProjection.FrameStallMs must be greater than zero for the clock watchdog to fire.";
            return false;
        }

        if (options.MaxFrameBytes <= 0)
        {
            error = "Sessions.PageProjection.MaxFrameBytes must be greater than zero — a non-positive cap could never fit a single part.";
            return false;
        }

        // EstablishChunkBytes / ClientStateMs are obsolete dead knobs — not validated; ignored on Launch.

        if (options.SwapTimeoutMs <= 0)
        {
            error = "Sessions.PageProjection.SwapTimeoutMs must be greater than zero — the double-buffer swap must always resolve.";
            return false;
        }

        if (options.ApplyBudgetMs < 0)
        {
            error = "Sessions.PageProjection.ApplyBudgetMs must not be negative.";
            return false;
        }

        if (options.MirrorMaxBytes <= 0)
        {
            error = "Sessions.PageProjection.MirrorMaxBytes must be greater than zero.";
            return false;
        }

        if (options.AssetCacheL1MaxBytes <= 0)
        {
            error = "Sessions.PageProjection.AssetCacheL1MaxBytes must be greater than zero.";
            return false;
        }

        if (options.AssetCacheL2MaxBytes < 0)
        {
            error = "Sessions.PageProjection.AssetCacheL2MaxBytes must not be negative.";
            return false;
        }

        if (options.AssetPriorityViewportPx < 0)
        {
            error = "Sessions.PageProjection.AssetPriorityViewportPx must not be negative.";
            return false;
        }

        if (options.BrowserPoolSize < 0)
        {
            error = "Sessions.PageProjection.BrowserPoolSize must not be negative.";
            return false;
        }

        if (options.BrowserPoolRefillPerSec <= 0)
        {
            error = "Sessions.PageProjection.BrowserPoolRefillPerSec must be greater than zero — zero would stall pool refill forever.";
            return false;
        }

        if (options.AggregateIntervalMs <= 0)
        {
            error = "Sessions.PageProjection.AggregateIntervalMs must be greater than zero.";
            return false;
        }

        error = string.Empty;
        return true;
    }
}
