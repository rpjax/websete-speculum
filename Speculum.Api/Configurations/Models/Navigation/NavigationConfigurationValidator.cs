using Microsoft.Extensions.Options;

namespace Speculum.Api.Configurations.Models.Navigation;

public sealed class NavigationConfigurationValidator
    : IValidateOptions<NavigationConfiguration>
{
    public ValidateOptionsResult Validate(string? name, NavigationConfiguration options)
    {
        var host = options.DefaultTargetHost.Trim();
        if (string.IsNullOrEmpty(host))
        {
            return ValidateOptionsResult.Success;
        }

        if (!Uri.TryCreate($"https://{host}", UriKind.Absolute, out var uri)
            || !string.Equals(uri.Host, host, StringComparison.OrdinalIgnoreCase))
        {
            return ValidateOptionsResult.Fail(
                "Navigation.DefaultTargetHost must be a valid host without a scheme or path.");
        }

        return ValidateOptionsResult.Success;
    }
}
