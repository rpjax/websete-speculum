using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Services.Contracts;

namespace Speculum.Api.Presentation.Dev;

/// <summary>
/// Development backdoor to read/write Hosting + Navigation through
/// <see cref="IConfigurationService"/> (same snapshot Sessions resolve against).
/// Mapped when <c>ASPNETCORE_ENVIRONMENT=Development</c> or
/// <c>SPECULUM_ENABLE_DEV_BACKDOOR=true</c>.
/// </summary>
public static class DevEngineConfigEndpoints
{
    public const string Path = "/api/dev/engine-config";

    public static IEndpointRouteBuilder MapDevEngineConfig(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        var env = endpoints.ServiceProvider.GetRequiredService<IHostEnvironment>();
        var backdoorFlag = Environment.GetEnvironmentVariable("SPECULUM_ENABLE_DEV_BACKDOOR");
        var enabled = env.IsDevelopment()
            || string.Equals(backdoorFlag, "true", StringComparison.OrdinalIgnoreCase)
            || string.Equals(backdoorFlag, "1", StringComparison.OrdinalIgnoreCase);
        if (!enabled)
        {
            return endpoints;
        }

        endpoints.MapGet(Path, (IConfigurationService configuration) =>
        {
            var current = configuration.GetCurrent();
            return Results.Ok(ToResponse(current));
        }).WithTags("Dev");

        endpoints.MapPut(Path, (DevEngineConfigRequest body, IConfigurationService configuration) =>
        {
            ArgumentNullException.ThrowIfNull(body);

            if (body.Hosting is { } hosting)
            {
                var hostingError = ValidateHosting(hosting);
                if (hostingError is not null)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["Hosting"] = [hostingError],
                    });
                }

                configuration.SetHosting(hosting);
            }

            if (body.Navigation is { } navigation)
            {
                var navigationError = ValidateNavigation(navigation);
                if (navigationError is not null)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["Navigation"] = [navigationError],
                    });
                }

                configuration.SetNavigation(navigation);
            }

            return Results.Ok(ToResponse(configuration.GetCurrent()));
        }).WithTags("Dev");

        return endpoints;
    }

    private static DevEngineConfigResponse ToResponse(
        EngineConfiguration current)
        => new()
        {
            Hosting = current.Hosting,
            Navigation = current.Navigation,
        };

    private static string? ValidateNavigation(NavigationConfiguration navigation)
    {
        var host = navigation.DefaultTargetHost.Trim();
        if (string.IsNullOrEmpty(host))
        {
            return "Navigation.DefaultTargetHost is required.";
        }

        if (!Uri.TryCreate($"https://{host}", UriKind.Absolute, out var uri)
            || !string.Equals(uri.Host, host, StringComparison.OrdinalIgnoreCase))
        {
            return "Navigation.DefaultTargetHost must be a valid host without a scheme or path.";
        }

        return null;
    }

    private static string? ValidateHosting(HostingConfiguration hosting)
    {
        foreach (var domain in hosting.Domains)
        {
            var value = domain.Domain.Trim();
            if (string.IsNullOrEmpty(value))
            {
                return "Hosting.Domains[].Domain must be non-empty.";
            }

            if (!Uri.TryCreate($"https://{value}", UriKind.Absolute, out var uri)
                || !string.Equals(uri.Host, value, StringComparison.OrdinalIgnoreCase))
            {
                return $"Hosting domain '{value}' is invalid.";
            }
        }

        return null;
    }
}

public sealed class DevEngineConfigRequest
{
    public HostingConfiguration? Hosting { get; init; }
    public NavigationConfiguration? Navigation { get; init; }
}

public sealed class DevEngineConfigResponse
{
    public required HostingConfiguration Hosting { get; init; }
    public required NavigationConfiguration Navigation { get; init; }
}
