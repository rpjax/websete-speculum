using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

/// <summary>
/// Matrix C (input), D (frames/status), N (popup/_blank) — Act via SignalR channels + Assert via probes.
/// </summary>
[Collection(nameof(MotorAssertCollection))]
[Trait("Category", "MotorAssertive")]
public sealed class InputFramesPopupTests(MotorAssertFixture fx)
{
    [MotorAssertFact]
    public async Task C1_mouse_click_increments_fixture_counter()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/click-target", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await Task.Delay(1200);
        await act.SendClickAsync(200, 140);
        await Task.Delay(800);

        var probe = await fx.Diagnostics.PostBrowserProbeAsync(
            act.ConnectionId!,
            ["evaluate"],
            evaluateExpression: "document.getElementById('out')?.getAttribute('data-clicks')");
        Assert.True(probe.GetProperty("ok").GetBoolean());
        Assert.Contains("1", probe.GetProperty("data").ToString(), StringComparison.Ordinal);
    }

    [MotorAssertFact]
    public async Task C2_keydown_reaches_fixture()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/click-target", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await Task.Delay(1000);
        // Focus input then press a key.
        await act.SendClickAsync(200, 216);
        await act.SendKeyAsync("a");
        await Task.Delay(600);

        var probe = await fx.Diagnostics.PostBrowserProbeAsync(
            act.ConnectionId!,
            ["evaluate"],
            evaluateExpression: "window.__SPECULUM_LAST_KEY__ || ''");
        Assert.Contains("a", probe.GetProperty("data").ToString(), StringComparison.OrdinalIgnoreCase);
    }

    [MotorAssertFact]
    public async Task C3_wheel_sets_fixture_flag()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/click-target", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await Task.Delay(1000);
        await act.SendWheelAsync(400, 300, 160);
        await Task.Delay(600);

        var probe = await fx.Diagnostics.PostBrowserProbeAsync(
            act.ConnectionId!,
            ["evaluate"],
            evaluateExpression: "window.__SPECULUM_WHEEL__ === true");
        Assert.Contains("true", probe.GetProperty("data").ToString(), StringComparison.OrdinalIgnoreCase);
    }

    [MotorAssertFact]
    public async Task C4_blocked_input_type_does_not_mutate_page()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/click-target", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await Task.Delay(800);
        await act.SendUserInputJsonAsync("""{"type":"paste","text":"nope"}""");
        await Task.Delay(400);

        var before = await fx.Diagnostics.PostBrowserProbeAsync(
            act.ConnectionId!,
            ["evaluate"],
            evaluateExpression: "document.getElementById('out')?.getAttribute('data-clicks')");
        Assert.Contains("0", before.GetProperty("data").ToString(), StringComparison.Ordinal);

        await act.SendClickAsync(200, 140);
        await Task.Delay(700);
        var after = await fx.Diagnostics.PostBrowserProbeAsync(
            act.ConnectionId!,
            ["evaluate"],
            evaluateExpression: "document.getElementById('out')?.getAttribute('data-clicks')");
        Assert.Contains("1", after.GetProperty("data").ToString(), StringComparison.Ordinal);
    }

    [MotorAssertFact]
    public async Task C5_malformed_json_input_is_ignored()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/click-target", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await act.SendUserInputJsonAsync("{not-json");
        await Task.Delay(300);
        var session = await fx.Diagnostics.TryGetSessionAsync(act.ConnectionId!);
        Assert.Equal("Running", session!.Value.GetProperty("snapshot").GetProperty("phase").GetString());
    }

    [MotorAssertFact]
    public async Task D3_frames_arrive_with_jpeg_and_sequence()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/home", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await act.WaitForFramesAsync(2, TimeSpan.FromSeconds(45));
        Assert.True(act.LastFrame is { Jpeg.Length: > 100 });
        Assert.True(act.LastFrameSequence >= 1);

        var session = await fx.Diagnostics.TryGetSessionAsync(act.ConnectionId!);
        var seq = session!.Value.GetProperty("snapshot").GetProperty("frameSequence").GetInt64();
        Assert.True(seq >= 1);
    }

    [MotorAssertFact]
    public async Task D4_status_channel_reports_single_tab()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/home", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var status = await act.WaitForStatusAsync(
            s => s.TabCount == 1 && s.Width > 0,
            TimeSpan.FromSeconds(45));
        Assert.Equal(1, status.TabCount);
        Assert.False(string.IsNullOrWhiteSpace(status.SessionId));
    }

    [MotorAssertFact]
    public async Task N1_N2_popup_and_blank_stay_single_tab()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/popup", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await Task.Delay(1000);
        // Open button is naturally near top-left of content; click generous hit box via eval fallback if needed.
        await act.EvalJsAsync(42, "document.getElementById('open')?.click(); document.getElementById('blank')?.click();");
        await Task.Delay(1500);

        var status = await act.WaitForStatusAsync(s => s.TabCount >= 1, TimeSpan.FromSeconds(20));
        Assert.Equal(1, status.TabCount);

        var probe = await fx.Diagnostics.PostBrowserProbeAsync(act.ConnectionId!, ["tabs"]);
        Assert.True(probe.GetProperty("ok").GetBoolean());
        var data = probe.GetProperty("data").ToString();
        // Single-tab enforcement: tabs payload must not advertise multiple live pages.
        Assert.DoesNotContain("\"length\":2", data, StringComparison.Ordinal);
    }

    [MotorAssertFact]
    public async Task I2_evaljs_mutates_page_observable_via_probe()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/home", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await Task.Delay(800);
        await act.EvalJsAsync(7, "window.__SPECULUM_EVAL__ = 'via-console-input';");
        await Task.Delay(800);

        var probe = await fx.Diagnostics.PostBrowserProbeAsync(
            act.ConnectionId!,
            ["evaluate"],
            evaluateExpression: "window.__SPECULUM_EVAL__");
        Assert.Contains("via-console-input", probe.GetProperty("data").ToString(), StringComparison.Ordinal);
    }

    [MotorAssertFact]
    public async Task I4_console_noise_produces_console_channel_traffic()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/console-noise", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(30);
        while (DateTime.UtcNow < deadline && act.ConsoleChunks < 1)
            await Task.Delay(200);

        Assert.True(act.ConsoleChunks >= 1, "expected OpenConsoleOutputChannel traffic from fixture console.log");
    }

    [MotorAssertFact]
    public async Task B4_programmatic_off_allowlist_navigate_keeps_session_alive()
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
        await act.EvalJsAsync(9, "window.goEvil && window.goEvil()");
        await Task.Delay(1500);

        var session = await fx.Diagnostics.TryGetSessionAsync(act.ConnectionId!);
        Assert.Equal("Running", session!.Value.GetProperty("snapshot").GetProperty("phase").GetString());

        var status = await act.WaitForStatusAsync(s => s.TabCount == 1, TimeSpan.FromSeconds(20));
        Assert.Equal(1, status.TabCount);
        Assert.DoesNotContain("evil-fixture", status.Url, StringComparison.OrdinalIgnoreCase);
    }
}
