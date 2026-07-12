namespace Speculum.Api.Config.Runtime;

public sealed class EdgeTlsOptions
{
    public string Provider { get; init; } = "cloudflare";
    public string Email { get; init; } = "";
    public string ApiToken { get; init; } = "";
}
