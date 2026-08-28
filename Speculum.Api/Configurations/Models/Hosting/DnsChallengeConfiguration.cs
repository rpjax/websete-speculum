namespace Speculum.Api.Configurations.Models.Hosting;

public sealed class DnsChallengeConfiguration
{
    public DnsChallengeProvider Provider { get; init; }
    public CloudflareDnsChallengeConfiguration? Cloudflare { get; init; }
}
