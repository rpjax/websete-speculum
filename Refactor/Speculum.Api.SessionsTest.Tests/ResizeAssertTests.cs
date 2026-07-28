namespace Speculum.SessionsTest.Tests;

/// <summary>Resize effect asserts (MATRIX D) — Chrome logical viewport + policy display capacity.</summary>
[Collection(nameof(SessionsTestCollection))]
[Trait("Category", "SessionsTest")]
public sealed class ResizeAssertTests : SessionsTestBase
{
    public ResizeAssertTests(SessionsTestFixture fixture) : base(fixture) { }

    /// <summary>
    /// Soft resize: logical Chrome geometry changes; display* reports Sessions.ViewportPolicy Maximum
    /// (Xvfb capacity) — not the logical size. Act→Assert via hub + journal + evaluate.
    /// </summary>
    [SessionsTestFact]
    public async Task D1_resize_exact_geometry_applied()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target", width: 1280, height: 720);

        var result = await act.ResizeAsync(757, 715);
        Assert.True(result.Applied);
        Assert.Equal(757, result.Width);
        Assert.Equal(715, result.Height);
        // Capacity ≠ logical — missing properties fail (no soft skip).
        Assert.NotNull(result.DisplayWidth);
        Assert.NotNull(result.DisplayHeight);
        Assert.Equal(4096, result.DisplayWidth);
        Assert.Equal(2160, result.DisplayHeight);
        Assert.NotEqual(result.Width, result.DisplayWidth);

        await act.WaitJournalAsync("Telemetry.Sessions.Resize.Applied", TimeSpan.FromSeconds(15));
        await act.WaitEvaluateContainsAsync(
            "window.innerWidth === 757 && window.innerHeight === 715",
            "true");
        // screen.* tracks logical viewport (soft metrics), not Xvfb capacity.
        await act.WaitEvaluateContainsAsync(
            "window.screen.width === 757 && window.screen.height === 715",
            "true");
    }

    [SessionsTestFact]
    public async Task D2_resize_below_policy_minimum_is_rejected()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target", width: 1280, height: 720);

        var result = await act.ResizeAsync(50, 50);
        Assert.False(result.Applied);
        Assert.Equal("invalid_viewport", result.ErrorCode);
        Assert.NotNull(result.DisplayWidth);
        Assert.NotNull(result.DisplayHeight);
        Assert.Equal(4096, result.DisplayWidth);
        Assert.Equal(2160, result.DisplayHeight);
        await act.WaitJournalAsync("Telemetry.Sessions.Resize.Rejected", TimeSpan.FromSeconds(15));

        // Prior logical size kept exactly — not a weak ≥100 smoke.
        await act.WaitEvaluateContainsAsync(
            "window.innerWidth === 1280 && window.innerHeight === 720",
            "true");
    }
}
