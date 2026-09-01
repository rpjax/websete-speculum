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
        Assert.True(
            result.Applied,
            $"Navigate Applied=false outcome={result.Outcome} errorCode={result.ErrorCode} phase={result.Phase} message={result.Message}");
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

            var nav = await act.NavigateAsync("/nav/b");
            Assert.True(
                nav.Applied,
                $"Navigate Applied=false outcome={nav.Outcome} errorCode={nav.ErrorCode} phase={nav.Phase} message={nav.Message}");
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
        var started = await act.StartFixturePageAsync("/popup");
        Assert.Equal("pageProjection", started.MirrorMode, ignoreCase: true);

        // Wait until Virtual is projecting — extension MAIN single-tab inject is live
        // only after the PP data plane is up (cold after VideoStreaming D*/H1 flips).
        await act.WaitPageProjectionFrameAsync(timeoutMs: 45_000);

        // MATRIX: window.open / target=_blank → same-tab. Prefer open() (init rewrite)
        // over HTMLElement.click(); CDP evaluate of click can race context teardown.
        _ = await act.EvaluateAsync(
            "(() => { const a = document.getElementById('blank'); if (!a) throw new Error('missing #blank'); const r = window.open(a.href, '_blank'); return r === null ? 'rewritten' : 'passthrough'; })()");
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
