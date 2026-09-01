using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Journal;
using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Models.ResourceManagement;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Configurations.Services.Contracts;

namespace Speculum.Api.Configurations.Services;

/// <summary>
/// Mandatory completeness for pending-config gate. Validators report invalid shape;
/// this reports incomplete mandatory sections.
/// </summary>
public static class ConfigurationCompleteness
{
    public static IReadOnlyList<string> MissingRequired(EngineConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        var missing = new List<string>();

        if (!IsNavigationComplete(configuration.Navigation))
            missing.Add(ConfigSectionDisplay.Navigation);

        if (!IsSessionsComplete(configuration.Sessions))
            missing.Add(ConfigSectionDisplay.Sessions);

        if (!IsResourceManagementComplete(configuration.ResourceManagement))
            missing.Add(ConfigSectionDisplay.ResourceManagement);

        return missing;
    }

    public static bool IsNavigationComplete(NavigationConfiguration navigation)
    {
        var host = navigation.DefaultTargetHost.Trim();
        if (string.IsNullOrEmpty(host))
            return false;

        return Uri.TryCreate($"https://{host}", UriKind.Absolute, out var uri)
            && string.Equals(uri.Host, host, StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsSessionsComplete(SessionsConfiguration sessions)
    {
        if (sessions.DetachedSessionTimeout <= TimeSpan.Zero)
            return false;

        var result = new SessionsConfigurationValidator()
            .Validate(Options.DefaultName, sessions);
        return result.Succeeded;
    }

    public static bool IsResourceManagementComplete(ResourceManagementConfiguration resources)
        => resources.Sessions.MaxConcurrentSessions > 0;

    public static bool IsHostingValid(HostingConfiguration hosting)
    {
        foreach (var domain in hosting.Domains)
        {
            var value = domain.Domain.Trim();
            if (string.IsNullOrEmpty(value))
                return false;

            if (!Uri.TryCreate($"https://{value}", UriKind.Absolute, out var uri)
                || !string.Equals(uri.Host, value, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
        }

        return true;
    }

    public static string? ValidateJournalEvents(JournalEventsConfiguration journal)
    {
        ArgumentNullException.ThrowIfNull(journal);
        foreach (var key in journal.Events.Keys)
        {
            if (string.IsNullOrWhiteSpace(key))
                return "Journal event type keys must be non-empty.";
        }

        return null;
    }
}

internal static class ConfigSectionDisplay
{
    public const string Hosting = "Hosting";
    public const string Navigation = "Navigation";
    public const string Sessions = "Sessions";
    public const string ResourceManagement = "ResourceManagement";
    public const string Journal = "Journal";
}
