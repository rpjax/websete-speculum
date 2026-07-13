using Speculum.Api.Motor.Live;

namespace Speculum.Api.Tests;

public sealed class SidecarInputGuardTests
{
    private static readonly string[] Domains = ["example.com", "*.cdn.example.com"];

    [Theory]
    [InlineData("https://example.com/path", true)]
    [InlineData("https://assets.cdn.example.com/x", true)]
    [InlineData("https://evil.com/", false)]
    [InlineData("ftp://example.com/", false)]
    public void IsNavigationUrlAllowed_respects_domain_allowlist(string url, bool expected)
    {
        Assert.Equal(expected, SidecarInputGuard.IsNavigationUrlAllowed(url, Domains));
    }

    [Theory]
    [InlineData("""{"type":"mousemove","x":1,"y":2}""", true)]
    [InlineData("""{"type":"keydown","key":"Enter"}""", true)]
    [InlineData("""{"type":"navigate","url":"https://evil.com"}""", false)]
    [InlineData("""{"type":"resize","width":100,"height":100}""", false)]
    [InlineData("not json", false)]
    public void TryValidateUserInputPayload_blocks_side_channel_commands(string payload, bool expected)
    {
        var ok = SidecarInputGuard.TryValidateUserInputPayload(payload, out var reason);
        Assert.Equal(expected, ok);
        if (!expected)
            Assert.False(string.IsNullOrWhiteSpace(reason));
    }
}
