using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Sidecar;

namespace Speculum.Api.Configurations.Models.Sidecar;

public sealed class SidecarOptionsValidator : IValidateOptions<SidecarOptions>
{
    public ValidateOptionsResult Validate(string? name, SidecarOptions options)
    {
        var failures = new List<string>();
        if (string.IsNullOrWhiteSpace(options.GrpcAddress))
        {
            failures.Add("Sidecar:GrpcAddress is required.");
        }
        else if (!Uri.TryCreate(options.GrpcAddress, UriKind.Absolute, out var uri)
                 || uri.Scheme is not ("http" or "https"))
        {
            failures.Add("Sidecar:GrpcAddress must be an absolute http(s) URI.");
        }

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }
}
