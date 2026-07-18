using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

[Collection(nameof(MotorAssertCollection))]
[Trait("Category", "MotorAssertive")]
public sealed class LifecycleAndNavigateTests : MotorAssertTestBase
{
    public LifecycleAndNavigateTests(MotorAssertFixture fixture) : base(fixture) { }

    [MotorAssertFact]
    public async Task A1_session_lifecycle_correlation_and_session_gone()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();

        var token = await act.StartSessionAsync(
            $"{fx.Host.FixtureClientOrigin}/", actId);

        Assert.False(string.IsNullOrWhiteSpace(token));
        Assert.False(string.IsNullOrWhiteSpace(act.ConnectionId));

        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var session = await fx.Diagnostics.TryGetSessionAsync(act.ConnectionId!);
        Assert.NotNull(session);
        var snapshot = session!.Value.GetProperty("snapshot");
        Assert.Equal("Running", snapshot.GetProperty("phase").GetString());

        var connId = act.ConnectionId!;
        await act.DisconnectAsync();

        await fx.Diagnostics.WaitForEventsAsync(
            connId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStopped"));

        await fx.Diagnostics.AssertSessionGoneAsync(connId);
    }

    [MotorAssertFact]
    public async Task A7_resource_probe_while_running_then_gone()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/home", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        // SessionStarted alone is not enough — wait until the fixture page is live before probing.
        await fx.Diagnostics.WaitFixturePageAsync(act.ConnectionId!, "home");
        var probe = await fx.Diagnostics.PostBrowserProbeAsync(
            act.ConnectionId!, ["process", "resources"]);
        Assert.True(probe.GetProperty("ok").GetBoolean());

        var connId = act.ConnectionId!;
        await act.DisconnectAsync();

        await fx.Diagnostics.WaitForEventsAsync(
            connId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStopped"));
        await fx.Diagnostics.AssertSessionGoneAsync(connId);
    }

    [MotorAssertFact]
    public async Task B1_navigate_in_allowlist_completed()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/nav/a", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var navSince = DateTimeOffset.UtcNow.AddSeconds(-1);
        await act.NavigateAsync($"{fx.Host.FixtureClientOrigin}/nav/b");
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Navigate", navSince,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.NavigateCompleted"));

        await fx.Diagnostics.ExpectEvaluateAsync(
            act.ConnectionId!,
            "location.pathname",
            "/nav/b");
    }

    [MotorAssertFact]
    public async Task B2_navigate_outside_allowlist_rejected()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        // Apex remap would turn evil.example → fixture.test; force NSO target host instead.
        var forbidden = MotorActClient.ClientUrlWithTargetHost(
            fx.Host.FixtureClientOrigin, "evil-fixture.test");

        var navSince = DateTimeOffset.UtcNow.AddSeconds(-1);
        var ex = await Assert.ThrowsAnyAsync<Exception>(() => act.NavigateAsync(forbidden));
        Assert.Contains("allowlist", ex.Message, StringComparison.OrdinalIgnoreCase);

        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Navigate", navSince,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.NavigateRejected"));

        var session = await fx.Diagnostics.TryGetSessionAsync(act.ConnectionId!);
        Assert.Equal("rejected", session!.Value.GetProperty("snapshot").GetProperty("lastNavigateResult").GetString());
    }

    [MotorAssertFact]
    public async Task B3_invalid_scheme_rejected()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await Assert.ThrowsAnyAsync<Exception>(() => act.NavigateAsync("ftp://fixture.test/"));
    }

    [MotorAssertFact]
    public async Task B11_spa_path_navigate()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/spa", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var navSince = DateTimeOffset.UtcNow.AddSeconds(-1);
        await act.NavigateAsync($"{fx.Host.FixtureClientOrigin}/spa/step-2");
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Navigate", navSince,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.NavigateCompleted"));
    }

    [MotorAssertFact]
    public async Task A10_client_token_round_trip_on_snapshot()
    {
        var token = MotorAssertTokens.New();
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/", actId, clientToken: token);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var session = await fx.Diagnostics.TryGetSessionAsync(act.ConnectionId!);
        var snap = session!.Value.GetProperty("snapshot");
        Assert.Equal(actId, snap.GetProperty("correlationId").GetString());
        Assert.Equal(token, snap.GetProperty("clientToken").GetString());
    }

    [MotorAssertFact]
    public async Task A10b_invalid_client_token_rejected()
    {
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        var ex = await Assert.ThrowsAnyAsync<Exception>(() =>
            act.StartSessionAsync(
                $"{fx.Host.FixtureClientOrigin}/",
                Guid.NewGuid().ToString("N"),
                clientToken: "tok-not-hex"));
        Assert.Contains("clientToken", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [MotorAssertFact]
    public async Task B9_path_and_query_preserved_on_navigate()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var navSince = DateTimeOffset.UtcNow.AddSeconds(-1);
        await act.NavigateAsync($"{fx.Host.FixtureClientOrigin}/nav/b?q=1&x=y");
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Navigate", navSince,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.NavigateCompleted"));

        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!,
            "location.pathname + location.search",
            "/nav/b?q=1");
    }

    [MotorAssertFact]
    public async Task B10_redirect_chain_lands_on_end()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/redirect", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await fx.Diagnostics.WaitFixturePageAsync(act.ConnectionId!, "redirect-end");
    }

    [MotorAssertFact]
    public async Task B6_asset_escape_page_loads_without_killing_session()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/asset-escape", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await fx.Diagnostics.WaitFixturePageAsync(act.ConnectionId!, "asset-escape");
        var session = await fx.Diagnostics.TryGetSessionAsync(act.ConnectionId!);
        Assert.Equal("Running", session!.Value.GetProperty("snapshot").GetProperty("phase").GetString());

        await fx.Diagnostics.ExpectEvaluateAsync(
            act.ConnectionId!,
            "document.getElementById('speculum-probe')?.dataset?.page",
            "asset-escape");
    }

    [MotorAssertFact]
    public async Task A3_max_sessions_rejects_second_start()
    {
        // Previous tests may still be releasing slots (export/stop). Cap only when idle.
        await fx.Diagnostics.WaitUntilRegistryIdleAsync();
        await fx.Host.PutConfigAsync("MaxSessions", 1);
        try
        {
            await using var a = new MotorActClient(fx.Host);
            await a.ConnectAsync();
            await a.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/", Guid.NewGuid().ToString("N"));

            await using var b = new MotorActClient(fx.Host);
            await b.ConnectAsync();
            var ex = await Assert.ThrowsAnyAsync<Exception>(
                () => b.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/", Guid.NewGuid().ToString("N")));
            Assert.Contains("Limite", ex.Message, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            await fx.Host.PutConfigAsync("MaxSessions", 4);
        }
    }

    [MotorAssertFact]
    public async Task A9_viewport_defaults_when_zero()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/", actId, width: 0, height: 0);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));
        var status = await act.WaitForStatusAsync(
            s => s.Width == 1280 && s.Height == 720,
            TimeSpan.FromSeconds(30));
        Assert.Equal(1280, status.Width);
        Assert.Equal(720, status.Height);

        var chrome = await fx.Diagnostics.PostBrowserProbeAsync(
            act.ConnectionId!,
            ["evaluate", "process"],
            evaluateExpression: "JSON.stringify({w: window.innerWidth, h: window.innerHeight})");
        Assert.True(chrome.GetProperty("ok").GetBoolean());
        var data = chrome.GetProperty("data");
        var evaluateRaw = data.GetProperty("evaluate").GetString();
        Assert.False(string.IsNullOrWhiteSpace(evaluateRaw), data.ToString());
        using var evaluateDoc = JsonDocument.Parse(evaluateRaw!);
        Assert.Equal(1280, evaluateDoc.RootElement.GetProperty("w").GetInt32());
        Assert.Equal(720, evaluateDoc.RootElement.GetProperty("h").GetInt32());
        Assert.Equal(1280, data.GetProperty("process").GetProperty("activeWidth").GetInt32());
        Assert.Equal(720, data.GetProperty("process").GetProperty("activeHeight").GetInt32());

        await act.WaitForJpegGeometryAsync(1280, 720, TimeSpan.FromSeconds(30));

        var session = await fx.Diagnostics.TryGetSessionAsync(act.ConnectionId!);
        Assert.Equal("Running", session!.Value.GetProperty("snapshot").GetProperty("phase").GetString());
    }
}
