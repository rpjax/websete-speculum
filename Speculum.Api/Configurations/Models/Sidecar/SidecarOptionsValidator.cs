using Microsoft.Extensions.Options;

namespace Speculum.Api.Configurations.Models.Sidecar;

public sealed class SidecarOptionsValidator : IValidateOptions<SidecarOptions>
{
    public ValidateOptionsResult Validate(string? name, SidecarOptions options)
    {
        var failures = new List<string>();
        if (!Enum.IsDefined(options.Engine))
        {
            failures.Add("Sidecar:Engine must be Gecko or Chromium.");
        }

        if (options.Engine == SidecarEngine.Gecko)
        {
            if (string.IsNullOrWhiteSpace(options.OrchestratorAddress))
            {
                failures.Add("Sidecar:OrchestratorAddress is required when Engine is Gecko.");
            }
            else if (!Uri.TryCreate(options.OrchestratorAddress, UriKind.Absolute, out var orch)
                     || orch.Scheme is not ("http" or "https"))
            {
                failures.Add("Sidecar:OrchestratorAddress must be an absolute http(s) URI.");
            }
        }
        else
        {
            if (string.IsNullOrWhiteSpace(options.GrpcAddress))
            {
                failures.Add("Sidecar:GrpcAddress is required when Engine is Chromium.");
            }
            else if (!Uri.TryCreate(options.GrpcAddress, UriKind.Absolute, out var uri)
                     || uri.Scheme is not ("http" or "https"))
            {
                failures.Add("Sidecar:GrpcAddress must be an absolute http(s) URI.");
            }
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
