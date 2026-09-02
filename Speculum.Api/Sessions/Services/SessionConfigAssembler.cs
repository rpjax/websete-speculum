using Aidan.Core.Patterns;
using Speculum.Api.Configurations.Models.Patterns;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Contracts;
using ClientEnvironmentPolicy =
    Speculum.Api.Configurations.Models.Sessions.ClientEnvironmentPolicy;

namespace Speculum.Api.Sessions.Services;

internal sealed class SessionConfigAssembler
{
    private readonly ILaunchScriptResolver _scripts;

    public SessionConfigAssembler(ILaunchScriptResolver scripts)
    {
        _scripts = scripts;
    }

    public async Task<IResult<SessionConfig>> AssembleAsync(
        StartSession request,
        EngineConfiguration configuration,
        CancellationToken ct = default)
    {
        var validation = Validate(request, configuration);
        if (validation.IsFailure)
        {
            return Result<SessionConfig>.Failure(validation.Errors.ToArray());
        }

        var scripts = await _scripts.ResolveAsync(configuration.Scripting, ct).ConfigureAwait(false);
        if (scripts.IsFailure)
        {
            return Result<SessionConfig>.Failure(scripts.Errors.ToArray());
        }

        return Result<SessionConfig>.Success(new SessionConfig
        {
            Resolution = new ScreenResolution
            {
                Width = request.ViewportWidth,
                Height = request.ViewportHeight,
            },
            Device = request.Device,
            ClientEnvironment = request.ClientEnvironment,
            Scripts = scripts.Value,
            JsBridgeEnabled = configuration.Sessions.IsJsBridgeEnabled,
            AllowedNavigationDomains = ProjectAllowedDomains(configuration),
            CpuProfiling = configuration.Sessions.CpuProfiling,
            InputPathTelemetry = configuration.Sessions.InputPathTelemetry,
        });
    }

    private static IResult Validate(
        StartSession request,
        EngineConfiguration configuration)
    {
        if (string.IsNullOrWhiteSpace(request.RequestHost))
        {
            return Result.Failure("Request host is required");
        }

        var resources = configuration.ResourceManagement.Sessions;
        if (resources.MaxConcurrentSessions <= 0)
        {
            return Result.Failure(
                "ResourceManagement.Sessions.MaxConcurrentSessions must be configured");
        }

        if (string.IsNullOrWhiteSpace(configuration.Navigation.DefaultTargetHost))
        {
            return Result.Failure("Navigation.DefaultTargetHost must be configured");
        }

        var viewport = configuration.Sessions.ViewportPolicy;
        if (request.ViewportWidth < viewport.Minimum.Width
            || request.ViewportHeight < viewport.Minimum.Height
            || request.ViewportWidth > viewport.Maximum.Width
            || request.ViewportHeight > viewport.Maximum.Height)
        {
            return Result.Failure("Start viewport is outside Sessions.ViewportPolicy bounds");
        }

        var device = request.Device;
        var policy = configuration.Sessions.DeviceEmulationPolicy;
        if (device is null
            || !double.IsFinite(device.DeviceScaleFactor)
            || device.DeviceScaleFactor < policy.MinDeviceScaleFactor
            || device.DeviceScaleFactor > policy.MaxDeviceScaleFactor
            || device.MaxTouchPoints < 0
            || device.MaxTouchPoints > policy.MaxTouchPoints
            || string.IsNullOrWhiteSpace(device.UserAgentProfile)
            || (!device.UserAgentProfile.Equals(
                    policy.DesktopUserAgentProfile,
                    StringComparison.OrdinalIgnoreCase)
                && !device.UserAgentProfile.Equals(
                    policy.MobileUserAgentProfile,
                    StringComparison.OrdinalIgnoreCase)
                && !device.UserAgentProfile.Equals(
                    string.IsNullOrWhiteSpace(policy.TabletUserAgentProfile)
                        ? "tablet"
                        : policy.TabletUserAgentProfile,
                    StringComparison.OrdinalIgnoreCase)
                && !device.UserAgentProfile.Equals("phone", StringComparison.OrdinalIgnoreCase)
                && !device.UserAgentProfile.Equals("tablet", StringComparison.OrdinalIgnoreCase)
                && !device.UserAgentProfile.Equals("pc", StringComparison.OrdinalIgnoreCase))
            || string.IsNullOrWhiteSpace(device.ScreenOrientation))
        {
            return Result.Failure("Start device mimicry is incomplete or invalid");
        }

        var environment = request.ClientEnvironment;
        if (environment is null
            || string.IsNullOrWhiteSpace(environment.Locale)
            || string.IsNullOrWhiteSpace(environment.Language)
            || string.IsNullOrWhiteSpace(environment.TimeZoneId)
            || !ClientEnvironmentPolicy.IsSupportedColorScheme(
                environment.ColorScheme))
        {
            return Result.Failure("Start client environment is incomplete");
        }

        if (environment.Geolocation is { } geolocation
            && (!double.IsFinite(geolocation.Latitude)
                || !double.IsFinite(geolocation.Longitude)
                || !double.IsFinite(geolocation.Accuracy)
                || geolocation.Latitude is < -90 or > 90
                || geolocation.Longitude is < -180 or > 180
                || geolocation.Accuracy < 0))
        {
            return Result.Failure("Start geolocation is invalid");
        }

        return Result.Success();
    }

    private static IReadOnlyList<string> ProjectAllowedDomains(
        EngineConfiguration configuration)
    {
        // Scope.Any → empty list: sidecar disables main-frame guard (open allowlist).
        if (configuration.Navigation.AllowedMainFrameUrls.Any(rule =>
                rule.Domain.Scope == PatternScope.Any))
        {
            return Array.Empty<string>();
        }

        var domains = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            configuration.Navigation.DefaultTargetHost.Trim().ToLowerInvariant(),
        };

        foreach (var rule in configuration.Navigation.AllowedMainFrameUrls)
        {
            if (TryProjectDomain(rule.Domain, out var pattern))
            {
                domains.Add(pattern);
            }
        }

        return domains.ToArray();
    }

    private static bool TryProjectDomain(DomainPattern domain, out string pattern)
    {
        pattern = "";
        if (domain.Scope != PatternScope.Pattern || domain.Labels.Count == 0)
        {
            return false;
        }

        var labels = new string[domain.Labels.Count];
        for (var i = 0; i < domain.Labels.Count; i++)
        {
            var label = domain.Labels[i];
            if (label.Match == PatternPartMatch.Any)
            {
                if (i != 0)
                {
                    return false;
                }

                labels[i] = "*";
                continue;
            }

            if (string.IsNullOrWhiteSpace(label.Value))
            {
                return false;
            }

            labels[i] = label.Value.Trim().ToLowerInvariant();
        }

        pattern = string.Join('.', labels);
        return true;
    }
}
