using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.ResourceManagement;

namespace Speculum.Api.Configurations.Models.ResourceManagement;

public sealed class ResourceManagementConfigurationValidator
    : IValidateOptions<ResourceManagementConfiguration>
{
    public ValidateOptionsResult Validate(string? name, ResourceManagementConfiguration options)
    {
        if (options.Sessions.MaxConcurrentSessions <= 0)
        {
            return ValidateOptionsResult.Fail(
                "ResourceManagement.Sessions.MaxConcurrentSessions must be greater than zero.");
        }

        return ValidateOptionsResult.Success;
    }
}
