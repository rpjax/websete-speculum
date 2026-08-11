using Microsoft.Extensions.Options;

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

        if (options.LinkRetryCount < 0 || options.LinkRetryCount > 20)
        {
            failures.Add("Sidecar:LinkRetryCount must be between 0 and 20.");
        }

        if (options.LinkRetryBackoff < TimeSpan.Zero
            || options.LinkRetryBackoff > TimeSpan.FromSeconds(30))
        {
            failures.Add("Sidecar:LinkRetryBackoff must be between 0 and 30 seconds.");
        }

        if (options.MaxGrpcMessageBytes < SidecarOptions.MinMaxGrpcMessageBytes
            || options.MaxGrpcMessageBytes > SidecarOptions.AbsoluteMaxGrpcMessageBytes)
        {
            failures.Add(
                $"Sidecar:MaxGrpcMessageBytes must be between {SidecarOptions.MinMaxGrpcMessageBytes} and {SidecarOptions.AbsoluteMaxGrpcMessageBytes}.");
        }

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }
}
