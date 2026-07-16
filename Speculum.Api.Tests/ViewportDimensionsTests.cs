using Speculum.Api.Motor.Live;

namespace Speculum.Api.Tests;

public sealed class ViewportDimensionsTests
{
    [Theory]
    [InlineData(1920, 1080, 1920, 1080)]
    [InlineData(800, 600, 800, 600)]
    [InlineData(0, 0, 1280, 720)]
    [InlineData(-1, 0, 1280, 720)]
    [InlineData(640, -10, 640, 720)]
    [InlineData(8000, 4000, 4096, 2160)]
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

    [Fact]
    public void NormalizeDevice_caps_dpr_and_enables_touch_for_mobile()
    {
        var d = ViewportDimensions.NormalizeDevice(new DeviceProfile
        {
            Mobile = true,
            DeviceScaleFactor = 4,
            MaxTouchPoints = 0,
        });
        Assert.True(d.Mobile);
        Assert.True(d.Touch);
        Assert.Equal(2, d.DeviceScaleFactor);
        Assert.Equal(5, d.MaxTouchPoints);
        Assert.Equal("mobile", d.UserAgentProfile);
    }

    [Fact]
    public void Normalize_clamps_oversized_resize_like_start()
    {
        var (w, h) = ViewportDimensions.Normalize(9000, 5000);
        Assert.Equal(ViewportDimensions.MaxWidth, w);
        Assert.Equal(ViewportDimensions.MaxHeight, h);
    }
}
