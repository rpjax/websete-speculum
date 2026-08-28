using Speculum.Api.Sessions.Models;

namespace Speculum.SessionsTest.Tests;

/// <summary>Resize effect asserts (MATRIX D) — Chrome logical viewport + policy display capacity.</summary>
[Collection(nameof(SessionsTestCollection))]
[Trait("Category", "SessionsTest")]
public sealed class ResizeAssertTests : SessionsTestBase
{
    public ResizeAssertTests(SessionsTestFixture fixture) : base(fixture) { }

    private static DeviceProfile MobileDevice => new()
    {
        Mobile = true,
        Touch = true,
        DeviceScaleFactor = 2,
        MaxTouchPoints = 5,
        UserAgentProfile = "mobile",
        DeviceCategory = "phone",
    };

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

    /// <summary>
    /// iPhone-class launch: logical 414×711 + mobile device must prove CSS layout viewport.
    /// Regression for LaunchBrowserFailed when fullscreen + metrics leave Chrome at ~980px.
    /// </summary>
    [SessionsTestFact]
    public async Task D4_mobile_iphone_logical_viewport_at_launch()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        var started = await act.StartFixturePageAsync(
            "/click-target",
            width: 414,
            height: 711,
            device: MobileDevice);

        Assert.False(string.IsNullOrWhiteSpace(started.Token));
        Assert.NotEqual(Guid.Empty, started.SessionId);

        await act.WaitEvaluateContainsAsync(
            "window.innerWidth === 414 && window.innerHeight === 711",
            "true");
        await act.WaitEvaluateContainsAsync(
            "window.screen.width === 414 && window.screen.height === 711",
            "true");

        var capacity = await act.ResizeAsync(414, 711, MobileDevice);
        Assert.True(capacity.Applied);
        Assert.Equal(414, capacity.Width);
        Assert.Equal(711, capacity.Height);
        Assert.NotNull(capacity.DisplayWidth);
        Assert.NotNull(capacity.DisplayHeight);
        Assert.Equal(4096, capacity.DisplayWidth);
        Assert.Equal(2160, capacity.DisplayHeight);
        Assert.NotEqual(414, capacity.DisplayWidth);
    }

    /// <summary>
    /// Mobile soft resize: 414×711 → 390×844 keeps logical Chrome geometry; display* = policy max.
    /// </summary>
    [SessionsTestFact]
    public async Task D5_mobile_soft_resize_keeps_logical_geometry()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync(
            "/click-target",
            width: 414,
            height: 711,
            device: MobileDevice);

        var result = await act.ResizeAsync(390, 844, MobileDevice);
        Assert.True(result.Applied);
        Assert.Equal(390, result.Width);
        Assert.Equal(844, result.Height);
        Assert.NotNull(result.DisplayWidth);
        Assert.NotNull(result.DisplayHeight);
        Assert.Equal(4096, result.DisplayWidth);
        Assert.Equal(2160, result.DisplayHeight);
        Assert.NotEqual(result.Width, result.DisplayWidth);

        await act.WaitJournalAsync("Telemetry.Sessions.Resize.Applied", TimeSpan.FromSeconds(15));
        await act.WaitEvaluateContainsAsync(
            "window.innerWidth === 390 && window.innerHeight === 844",
            "true");
        await act.WaitEvaluateContainsAsync(
            "window.screen.width === 390 && window.screen.height === 844",
            "true");
    }

    /// <summary>
    /// Rule in stone: a stable client box must never produce Resize journal facts.
    /// SessionsTest drives the hub without SPA ViewportSync — after Start at a fixed
    /// size, the server must emit zero Resize.Applied/Rejected while we do not call Resize.
    /// </summary>
    [SessionsTestFact]
    public async Task D6_stable_screen_session_never_resizes()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        // Drain any startup noise before the quiet window.
        act.ClearJournal();
        await act.StartFixturePageAsync("/click-target", width: 1280, height: 720);
        act.ClearJournal();

        await Task.Delay(TimeSpan.FromSeconds(3));

        Assert.Equal(0, act.CountJournal("Telemetry.Sessions.Resize.Applied"));
        Assert.Equal(0, act.CountJournal("Telemetry.Sessions.Resize.Rejected"));

        // Geometry still exactly the Start size — proves we did not silently resize.
        await act.WaitEvaluateContainsAsync(
            "window.innerWidth === 1280 && window.innerHeight === 720",
            "true");
    }
}
