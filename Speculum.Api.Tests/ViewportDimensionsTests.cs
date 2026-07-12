using Speculum.Api.Virtualization;

namespace Speculum.Api.Tests;

public sealed class ViewportDimensionsTests
{
    [Theory]
    [InlineData(1920, 1080, 1920, 1080)]
    [InlineData(800, 600, 800, 600)]
    [InlineData(0, 0, 1280, 720)]
    [InlineData(-1, 0, 1280, 720)]
    [InlineData(640, -10, 640, 720)]
    public void Normalize_uses_client_viewport_or_defaults(
        int inputW, int inputH, int expectedW, int expectedH)
    {
        var (w, h) = ViewportDimensions.Normalize(inputW, inputH);
        Assert.Equal(expectedW, w);
        Assert.Equal(expectedH, h);
    }

    [Fact]
    public void SessionConfigSnapshot_receives_normalized_dimensions()
    {
        var (w, h) = ViewportDimensions.Normalize(1440, 900);
        var snapshot = new SessionConfigSnapshot
        {
            InitialUrl = "https://example.com",
            Width      = w,
            Height     = h,
        };

        Assert.Equal(1440, snapshot.Width);
        Assert.Equal(900, snapshot.Height);
    }
}
