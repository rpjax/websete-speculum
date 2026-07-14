using System.Net;
using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

[Collection(nameof(MotorAssertCollection))]
[Trait("Category", "MotorAssertive")]
public sealed class NavigationDeepTests(MotorAssertFixture fx)
{
    [MotorAssertFact]
    public async Task B4b_goEvil_emits_redirect_wire_and_keeps_tabs()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/external-link", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await Task.Delay(800);
        await act.EvalJsAsync(11, "window.goEvil && window.goEvil()");
        await act.WaitForRedirectAsync(TimeSpan.FromSeconds(30));

        Assert.Contains(act.RedirectUrls, u => u.Contains("evil-fixture", StringComparison.OrdinalIgnoreCase));

        var session = await fx.Diagnostics.RequireSessionAsync(act.ConnectionId!);
        Assert.Equal("Running", fx.Diagnostics.RequireString(fx.Diagnostics.RequireSnapshot(session), "phase"));

        var status = await act.WaitForStatusAsync(s => s.TabCount == 1, TimeSpan.FromSeconds(20));
        Assert.Equal(1, status.TabCount);
        Assert.DoesNotContain("evil-fixture", status.Url, StringComparison.OrdinalIgnoreCase);
    }

    [MotorAssertFact]
    public async Task B5_wildcard_subdomain_allowed()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var url = MotorActClient.ClientUrlWithTargetHost(
            fx.Host.FixtureClientOrigin, "www.fixture.test", "/home");
        var navSince = DateTimeOffset.UtcNow.AddSeconds(-1);
        await act.NavigateAsync(url);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Navigate", navSince,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.NavigateCompleted"));

        await Task.Delay(1200);
        await fx.Diagnostics.ExpectEvaluateAsync(
            act.ConnectionId!,
            "location.hostname",
            "www.fixture.test");
    }

    [MotorAssertFact]
    public async Task B7_nso_apex_lands_on_target_host()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        var clientUrl = MotorActClient.ClientUrlWithTargetHost(
            fx.Host.FixtureClientOrigin, "fixture.test", "/nav/b");

        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync(clientUrl, actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await Task.Delay(1200);
        await fx.Diagnostics.ExpectEvaluateAsync(
            act.ConnectionId!,
            "location.hostname + location.pathname",
            "fixture.test");
        await fx.Diagnostics.ExpectEvaluateAsync(
            act.ConnectionId!,
            "document.getElementById('speculum-probe')?.dataset?.page",
            "nav-b");
    }

    [MotorAssertFact]
    public async Task B8_mirroring_operational_and_sub_host()
    {
        var put = await fx.Host.PutConfigAsync("Hosting", new
        {
            profiles = new object[]
            {
                new
                {
                    domain = "speculum.test",
                    subdomainMirroringEnabled = true,
                    edgeTls = new
                    {
                        provider = "cloudflare",
                        email = "motor-assert@example.com",
                        apiToken = "motor-assert-cf-token",
                    },
                },
            },
        });
        put.EnsureSuccessStatusCode();

        try
        {
            var status = await fx.Host.Http.GetAsync("api/admin/config/status");
            status.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await status.Content.ReadAsStringAsync());
            var text = doc.RootElement.ToString();
            Assert.Contains("mirroringOperational", text, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("true", text, StringComparison.OrdinalIgnoreCase);

            var since = DateTimeOffset.UtcNow.AddSeconds(-2);
            var actId = Guid.NewGuid().ToString("N");
            // Client host sub.speculum.test maps to sub.fixture.test under mirroring.
            var clientUrl = "https://www.speculum.test/home";
            await using var act = new MotorActClient(fx.Host);
            await act.ConnectAsync();
            await act.StartSessionAsync(clientUrl, actId);
            await fx.Diagnostics.WaitForEventsAsync(
                act.ConnectionId, "Motor.Session", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

            await Task.Delay(1500);
            await fx.Diagnostics.ExpectEvaluateAsync(
                act.ConnectionId!,
                "location.hostname",
                "www.fixture.test");
            await fx.Diagnostics.ExpectCookieAsync(act.ConnectionId!, "sf_marker");
        }
        finally
        {
            var restore = await fx.RestoreHostingApexAsync();
            restore.EnsureSuccessStatusCode();
        }
    }

    [MotorAssertFact]
    public async Task B10b_goback_goforward_after_nav_a_to_b()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/nav/a", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await act.NavigateAsync($"{fx.Host.FixtureClientOrigin}/nav/b");
        await Task.Delay(1200);
        await fx.Diagnostics.ExpectEvaluateAsync(
            act.ConnectionId!,
            "document.getElementById('speculum-probe')?.dataset?.page",
            "nav-b");

        await act.SendGoBackAsync();
        await Task.Delay(1200);
        await fx.Diagnostics.ExpectEvaluateAsync(
            act.ConnectionId!,
            "document.getElementById('speculum-probe')?.dataset?.page",
            "nav-a");

        await act.SendGoForwardAsync();
        await Task.Delay(1200);
        await fx.Diagnostics.ExpectEvaluateAsync(
            act.ConnectionId!,
            "document.getElementById('speculum-probe')?.dataset?.page",
            "nav-b");
    }

    [MotorAssertFact]
    public async Task D2_resize_below_100_is_noop()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/", actId, width: 1280, height: 720);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await act.WaitForStatusAsync(s => s.Width == 1280 && s.Height == 720, TimeSpan.FromSeconds(30));
        await act.ResizeAsync(50, 50);
        await Task.Delay(800);
        var status = await act.WaitForStatusAsync(s => true, TimeSpan.FromSeconds(10));
        Assert.Equal(1280, status.Width);
        Assert.Equal(720, status.Height);
    }
}
