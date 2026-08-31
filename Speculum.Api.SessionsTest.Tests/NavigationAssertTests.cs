namespace Speculum.SessionsTest.Tests;

/// <summary>Navigate / history / single-tab effect asserts (MATRIX B1, H1, N1).</summary>
[Collection(nameof(SessionsTestCollection))]
[Trait("Category", "SessionsTest")]
public sealed class NavigationAssertTests : SessionsTestBase
{
    public NavigationAssertTests(SessionsTestFixture fixture) : base(fixture) { }

    [SessionsTestFact]
    public async Task B1_navigate_updates_location()
    {
        await Fx.EnsureSessionsMirrorModeAsync("pageProjection");
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/nav/a");

        var result = await act.NavigateAsync("/nav/b");
        Assert.True(result.Applied);
        Assert.Equal("Applied", result.Outcome);

        await act.WaitEvaluateContainsAsync("location.pathname", "/nav/b", TimeSpan.FromSeconds(30));
    }

    [SessionsTestFact]
    public async Task H1_goback_updates_location()
    {
        // Legacy VideoStreaming harness goback — product PP history is intent-only.
        await Fx.EnsureSessionsMirrorModeAsync("videoStreaming");
        try
        {
            await using var act = new SessionsActClient(Fx.Host);
            await act.ConnectAsync();
            await act.StartFixturePageAsync("/nav/a");

            Assert.True((await act.NavigateAsync("/nav/b")).Applied);
            await act.WaitEvaluateContainsAsync("location.pathname", "/nav/b", TimeSpan.FromSeconds(30));

            await act.SendInputAsync("goback", """{"type":"goback"}""");
            await act.WaitEvaluateContainsAsync("location.pathname", "/nav/a", TimeSpan.FromSeconds(30));
        }
        finally
        {
            await Fx.EnsureSessionsMirrorModeAsync("pageProjection");
        }
    }

    [SessionsTestFact]
    public async Task N1_blank_stays_single_tab()
    {
        await Fx.EnsureSessionsMirrorModeAsync("pageProjection");
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/popup");

        // Click the _blank link; sidecar single-tab should navigate the main page (no separate tab).
        await act.EvaluateAsync("document.getElementById('blank').click(); 'ok'");
        await act.WaitEvaluateContainsAsync("location.pathname", "/nav/b", TimeSpan.FromSeconds(30));

        // Still one live evaluate surface on the main page (popup pages are closed by interception).
        // Fixture /nav/b stamps data-page="nav-b" (hyphen), not the path slash form.
        var page = await act.EvaluateAsync(
            "document.querySelector('#speculum-probe')?.getAttribute('data-page') ?? location.pathname");
        Assert.True(
            page.Contains("nav-b", StringComparison.OrdinalIgnoreCase)
            || page.Contains("/nav/b", StringComparison.Ordinal),
            $"expected main frame on /nav/b (probe nav-b), got: {page}");
    }
}
