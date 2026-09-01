namespace Speculum.Api.Configurations.Models.Hosting;

public sealed class CloudflareDnsChallengeConfiguration
{
    public string Email { get; init; } = "";
    public string ApiToken { get; init; } = "";
}
