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
    [InlineData("""{"type":"mousedown","x":1,"y":2,"button":0}""", true)]
    [InlineData("""{"type":"mouseup","x":1,"y":2,"button":2}""", true)]
    [InlineData("""{"type":"wheel","x":1,"y":2,"deltaX":0,"deltaY":1}""", true)]
    [InlineData("""{"type":"keydown","key":"Enter"}""", true)]
    [InlineData("""{"type":"keyup","key":"a"}""", true)]
    [InlineData("""{"type":"goback"}""", true)]
    [InlineData("""{"type":"goforward"}""", true)]
    [InlineData("""{"type":"touch","phase":"start","points":[{"id":1,"x":10,"y":20}],"changedIds":[1]}""", true)]
    [InlineData("""{"type":"touch","phase":"end","points":[],"changedIds":[1]}""", true)]
    [InlineData("""{"type":"touch","phase":"end","points":[{"id":2,"x":1,"y":2}],"changedIds":[1]}""", true)]
    [InlineData("""{"type":"text","text":"hi"}""", true)]
    [InlineData("""{"type":"navigate","url":"https://evil.com"}""", false)]
    [InlineData("""{"type":"resize","width":100,"height":100}""", false)]
    [InlineData("""{"type":"touch","phase":"start","points":[],"changedIds":[1]}""", false)]
    [InlineData("""{"type":"touch","phase":"move","points":[],"changedIds":[1]}""", false)]
    [InlineData("""{"type":"touch","phase":"start","points":[],"changedIds":[]}""", false)]
    [InlineData("""{"type":"touch","phase":"boom","points":[{"id":1,"x":1,"y":2}],"changedIds":[1]}""", false)]
    [InlineData("""{"type":"text","text":""}""", false)]
    [InlineData("not json", false)]
    public void TryValidateUserInputPayload_blocks_side_channel_commands(string payload, bool expected)
    {
        var ok = SidecarInputGuard.TryValidateUserInputPayload(payload, out var reason);
        Assert.Equal(expected, ok);
        if (!expected)
            Assert.False(string.IsNullOrWhiteSpace(reason));
    }

    [Fact]
    public void TryValidateUserInputPayload_rejects_duplicate_touch_ids()
    {
        var payload = """{"type":"touch","phase":"move","points":[{"id":1,"x":1,"y":2},{"id":1,"x":3,"y":4}],"changedIds":[1]}""";
        Assert.False(SidecarInputGuard.TryValidateUserInputPayload(payload, out var reason));
        Assert.Contains("duplicate", reason!, StringComparison.OrdinalIgnoreCase);
    }
}
