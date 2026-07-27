using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.Presentation.Dev;

/// <summary>
/// Development backdoor to read/write Hosting + Navigation through
/// <see cref="IConfigurationService"/> and explicitly toggle opt-in Journal types
/// via <see cref="IJournalCatalog.SetEnabled"/> (test/debug only — never auto-on).
/// Mapped when <c>ASPNETCORE_ENVIRONMENT=Development</c> or
/// <c>SPECULUM_ENABLE_DEV_BACKDOOR=true</c>.
/// </summary>
public static class DevEngineConfigEndpoints
{
    public const string Path = "/api/dev/engine-config";

    /// <summary>Journal types that may be toggled through this backdoor.</summary>
    public static readonly string[] ToggleableJournalTypes =
    [
        "Sessions.InputApplied",
        "Sessions.ResizeApplied",
        "Sessions.ResizeRejected",
    ];

    public static IEndpointRouteBuilder MapDevEngineConfig(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        if (!DevBackdoorGate.IsEnabled(endpoints.ServiceProvider))
        {
            return endpoints;
        }

        endpoints.MapGet(Path, (
            IConfigurationService configuration,
            IJournalCatalog journalCatalog) =>
        {
            var current = configuration.GetCurrent();
            return Results.Ok(ToResponse(current, journalCatalog));
        }).WithTags("Dev");

        endpoints.MapPut(Path, (
            DevEngineConfigRequest body,
            IConfigurationService configuration,
            IJournalCatalog journalCatalog) =>
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

            if (body.Journal is { } journal)
            {
                foreach (var (type, enabled) in journal)
                {
                    if (!ToggleableJournalTypes.Contains(type, StringComparer.Ordinal))
                    {
                        return Results.ValidationProblem(new Dictionary<string, string[]>
                        {
                            ["Journal"] = [$"Journal type '{type}' is not toggleable via the backdoor."],
                        });
                    }

                    try
                    {
                        journalCatalog.SetEnabled(type, enabled);
                    }
                    catch (ArgumentException ex)
                    {
                        return Results.ValidationProblem(new Dictionary<string, string[]>
                        {
                            ["Journal"] = [ex.Message],
                        });
                    }
                }
            }

            return Results.Ok(ToResponse(configuration.GetCurrent(), journalCatalog));
        }).WithTags("Dev");

        return endpoints;
    }

    private static DevEngineConfigResponse ToResponse(
        EngineConfiguration current,
        IJournalCatalog journalCatalog)
    {
        var journal = new Dictionary<string, bool>(StringComparer.Ordinal);
        foreach (var type in ToggleableJournalTypes)
        {
            journal[type] = journalCatalog.IsTypeEnabled(type);
        }

        return new DevEngineConfigResponse
        {
            Hosting = current.Hosting,
            Navigation = current.Navigation,
            Journal = journal,
        };
    }

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

    /// <summary>
    /// Explicit Journal enablement map. Keys must be toggleable types.
    /// Omitted keys are left unchanged (defaults remain off for opt-in facts).
    /// </summary>
    public Dictionary<string, bool>? Journal { get; init; }
}

public sealed class DevEngineConfigResponse
{
    public required HostingConfiguration Hosting { get; init; }
    public required NavigationConfiguration Navigation { get; init; }
    public required Dictionary<string, bool> Journal { get; init; }
}
