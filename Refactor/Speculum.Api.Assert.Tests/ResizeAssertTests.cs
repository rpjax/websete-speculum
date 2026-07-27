namespace Speculum.SessionsAssert.Tests;

/// <summary>Resize effect asserts (MATRIX D-style) with opt-in journal.</summary>
[Collection(nameof(SessionsAssertCollection))]
[Trait("Category", "SessionsAssertive")]
public sealed class ResizeAssertTests : SessionsAssertTestBase
{
    public ResizeAssertTests(SessionsAssertFixture fixture) : base(fixture) { }

    [SessionsAssertFact]
    public async Task D1_resize_exact_geometry_applied()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target", width: 1280, height: 720);

        var result = await act.ResizeAsync(757, 715);
        Assert.True(result.Applied);
        Assert.Equal(757, result.Width);
        Assert.Equal(715, result.Height);

        await act.WaitJournalAsync("Sessions.ResizeApplied", TimeSpan.FromSeconds(15));
        await act.WaitEvaluateContainsAsync(
            "window.innerWidth === 757 && window.innerHeight === 715",
            "true");
    }

    [SessionsAssertFact]
    public async Task D2_resize_below_100_is_rejected()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target", width: 1280, height: 720);

        var result = await act.ResizeAsync(50, 50);
        Assert.False(result.Applied);
        Assert.Equal("invalid_viewport", result.ErrorCode);
        await act.WaitJournalAsync("Sessions.ResizeRejected", TimeSpan.FromSeconds(15));

        await act.WaitEvaluateContainsAsync(
            "window.innerWidth >= 100 && window.innerHeight >= 100",
            "true");
    }
}
