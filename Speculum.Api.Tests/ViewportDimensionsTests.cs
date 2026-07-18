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
    public void NormalizeStart_uses_client_viewport_or_defaults(
        int inputW, int inputH, int expectedW, int expectedH)
    {
        var (w, h) = ViewportDimensions.NormalizeStart(inputW, inputH);
        Assert.Equal(expectedW, w);
        Assert.Equal(expectedH, h);
    }

    [Fact]
    public void Normalize_alias_matches_NormalizeStart()
    {
        var (w, h) = ViewportDimensions.Normalize(1440, 900);
        Assert.Equal(1440, w);
        Assert.Equal(900, h);
    }

    [Fact]
    public void SessionConfigSnapshot_receives_normalized_dimensions()
    {
        var (w, h) = ViewportDimensions.NormalizeStart(1440, 900);
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
    public void TryValidateResize_rejects_below_minimum()
    {
        Assert.False(ViewportDimensions.TryValidateResize(50, 50, out _, out _, out var message));
        Assert.Contains("below minimum", message);
    }

    [Fact]
    public void TryValidateResize_rejects_above_maximum()
    {
        Assert.False(ViewportDimensions.TryValidateResize(9000, 5000, out _, out _, out var message));
        Assert.Contains("above maximum", message);
    }

    [Fact]
    public void TryValidateResize_accepts_exact_odd_geometry()
    {
        Assert.True(ViewportDimensions.TryValidateResize(757, 715, out var w, out var h, out _));
        Assert.Equal(757, w);
        Assert.Equal(715, h);
    }
}
