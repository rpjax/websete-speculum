using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Sessions;

namespace Speculum.Api.Configurations.Models.Sessions;

public sealed class SessionsConfigurationValidator : IValidateOptions<SessionsConfiguration>
{
    public ValidateOptionsResult Validate(string? name, SessionsConfiguration options)
    {
        if (options.DetachedSessionTimeout <= TimeSpan.Zero)
        {
            return ValidateOptionsResult.Fail(
                "Sessions.DetachedSessionTimeout must be greater than zero.");
        }

        return ValidateOptionsResult.Success;
    }
}
