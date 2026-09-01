using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.ResourceManagement;

namespace Speculum.Api.Configurations.Models.ResourceManagement;

public sealed class ResourceManagementConfigurationValidator
    : IValidateOptions<ResourceManagementConfiguration>
{
    public ValidateOptionsResult Validate(string? name, ResourceManagementConfiguration options)
    {
        // <= 0 means incomplete (pending config), not invalid shape.
        if (options.Sessions.MaxConcurrentSessions < 0)
        {
            return ValidateOptionsResult.Fail(
                "ResourceManagement.Sessions.MaxConcurrentSessions must be >= 0.");
        }

        if (options.Profiles.InactiveRetentionPeriod <= TimeSpan.Zero)
        {
            return ValidateOptionsResult.Fail(
                "ResourceManagement.Profiles.InactiveRetentionPeriod must be > 0.");
        }

        if (options.Storage.BudgetBytes <= 0)
        {
            return ValidateOptionsResult.Fail(
                "ResourceManagement.Storage.BudgetBytes must be > 0.");
        }

        if (options.Storage.SessionTelemetryRetention <= TimeSpan.Zero
            || options.Storage.TelemetrySampleRetention <= TimeSpan.Zero
            || options.Storage.JournalFactRetention <= TimeSpan.Zero)
        {
            return ValidateOptionsResult.Fail(
                "ResourceManagement.Storage retention periods must be > 0.");
        }

        return ValidateOptionsResult.Success;
    }
}
