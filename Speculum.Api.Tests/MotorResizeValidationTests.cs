using Speculum.Api.Motor.Live;

namespace Speculum.Api.Tests;

public sealed class MotorResizeValidationTests
{
    [Fact]
    public void TryValidateResize_rejects_below_100_with_stable_code_path()
    {
        Assert.False(ViewportDimensions.TryValidateResize(99, 720, out _, out _, out var message));
        Assert.Contains("below minimum", message);
    }

    [Fact]
    public void NormalizeStart_still_maps_zero_sentinel()
    {
        var (w, h) = ViewportDimensions.NormalizeStart(0, 0);
        Assert.Equal(1280, w);
        Assert.Equal(720, h);
    }
}
