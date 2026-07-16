using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

/// <summary>
/// Matrix C (input), D (frames/status), N (popup/_blank) — Act via SignalR channels + Assert via probes.
/// </summary>
[Collection(nameof(MotorAssertCollection))]
[Trait("Category", "MotorAssertive")]
public sealed class InputFramesPopupTests : MotorAssertTestBase
{
    public InputFramesPopupTests(MotorAssertFixture fixture) : base(fixture) { }

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

        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "document.getElementById('out')?.getAttribute('data-clicks')", "0");
        await act.SendClickAsync(200, 140);
        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "document.getElementById('out')?.getAttribute('data-clicks')", "1");
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

        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "document.getElementById('out')?.getAttribute('data-clicks')", "0");
        // Focus input then press a key.
        await act.SendClickAsync(200, 216);
        await act.SendKeyAsync("a");
        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "window.__SPECULUM_LAST_KEY__ || ''", "a");
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

        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "document.getElementById('out')?.getAttribute('data-clicks')", "0");
        await act.SendWheelAsync(400, 300, 160);
        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "window.__SPECULUM_WHEEL__ === true", "true");
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

        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "document.getElementById('out')?.getAttribute('data-clicks')", "0");
        await act.SendUserInputJsonAsync("""{"type":"paste","text":"nope"}""");

        var before = await fx.Diagnostics.PostBrowserProbeAsync(
            act.ConnectionId!,
            ["evaluate"],
            evaluateExpression: "document.getElementById('out')?.getAttribute('data-clicks')");
        Assert.Contains("0", before.GetProperty("data").ToString(), StringComparison.Ordinal);

        await act.SendClickAsync(200, 140);
        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "document.getElementById('out')?.getAttribute('data-clicks')", "1");
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
        var session = await fx.Diagnostics.TryGetSessionAsync(act.ConnectionId!);
        Assert.Equal("Running", session!.Value.GetProperty("snapshot").GetProperty("phase").GetString());
    }

    [MotorAssertFact]
    public async Task C6_touch_tap_increments_fixture_counter()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync(
            $"{fx.Host.FixtureClientOrigin}/click-target", actId,
            device: new MotorDeviceProfile
            {
                Mobile = true, Touch = true, DeviceScaleFactor = 1, MaxTouchPoints = 5,
                UserAgentProfile = "mobile",
            });
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "document.getElementById('out')?.getAttribute('data-clicks')", "0");
        await act.SendTouchTapAsync(200, 140);
        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "document.getElementById('out')?.getAttribute('data-clicks')", "1");
    }

    [MotorAssertFact]
    public async Task C7_touch_cancel_does_not_click()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync(
            $"{fx.Host.FixtureClientOrigin}/click-target", actId,
            device: new MotorDeviceProfile
            {
                Mobile = true, Touch = true, DeviceScaleFactor = 1, MaxTouchPoints = 5,
                UserAgentProfile = "mobile",
            });
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var point = new { id = 1, x = 200.0, y = 140.0, radiusX = 1.0, radiusY = 1.0, force = 0.5 };
        await act.SendTouchAsync("start", [point], [1]);
        await act.SendTouchAsync("cancel", [], [1]);
        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "window.__SPECULUM_TOUCH__?.cancels >= 1", "true");
        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "document.getElementById('out')?.getAttribute('data-clicks')", "0");
    }

    [MotorAssertFact]
    public async Task C8_multitouch_reports_two_points()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync(
            $"{fx.Host.FixtureClientOrigin}/click-target", actId,
            device: new MotorDeviceProfile
            {
                Mobile = true, Touch = true, DeviceScaleFactor = 1, MaxTouchPoints = 5,
                UserAgentProfile = "mobile",
            });
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var p1 = new { id = 1, x = 180.0, y = 130.0, radiusX = 1.0, radiusY = 1.0, force = 0.5 };
        var p2 = new { id = 2, x = 220.0, y = 150.0, radiusX = 1.0, radiusY = 1.0, force = 0.5 };
        await act.SendTouchAsync("start", [p1], [1]);
        await act.SendTouchAsync("start", [p1, p2], [2]);
        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "window.__SPECULUM_TOUCH__?.maxPoints >= 2", "true");
        await act.SendTouchAsync("end", [], [1, 2]);
    }

    [MotorAssertFact]
    public async Task C9_input_rejected_emits_catalog_event()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/click-target", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var rejectSince = DateTimeOffset.UtcNow.AddSeconds(-1);
        await act.SendUserInputJsonAsync("""{"type":"paste","text":"nope"}""");
        var rejected = await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.InputRejected", rejectSince,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.InputRejected"));
        var payload = rejected.First(e => e.GetProperty("name").GetString() == "Motor.InputRejected")
            .GetProperty("payload");
        Assert.Equal("input_blocked", payload.GetProperty("errorCode").GetString());
        Assert.Equal("validate", payload.GetProperty("phase").GetString());
        await act.SendClickAsync(200, 140);
        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "document.getElementById('out')?.getAttribute('data-clicks')", "1");
    }

    [MotorAssertFact]
    public async Task C10_touch_scroll_moves_scrollTop()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync(
            $"{fx.Host.FixtureClientOrigin}/touch-scroll", actId,
            device: new MotorDeviceProfile
            {
                Mobile = true, Touch = true, DeviceScaleFactor = 1, MaxTouchPoints = 5,
                UserAgentProfile = "mobile",
            });
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "document.getElementById('speculum-probe')?.dataset.page", "touch-scroll");

        var id = 1;
        await act.SendTouchAsync("start", [new { id, x = 200.0, y = 400.0, radiusX = 1.0, radiusY = 1.0, force = 0.5 }], [id]);
        for (var y = 380; y >= 120; y -= 40)
        {
            await act.SendTouchAsync("move", [new { id, x = 200.0, y = (double)y, radiusX = 1.0, radiusY = 1.0, force = 0.5 }], [id]);
        }
        await act.SendTouchAsync("end", [], [id]);

        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "window.__SPECULUM_SCROLL__ > 20", "true");
    }

    [MotorAssertFact]
    public async Task C11_mobile_device_profile_sets_maxTouchPoints()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync(
            $"{fx.Host.FixtureClientOrigin}/click-target", actId,
            device: new MotorDeviceProfile
            {
                Mobile = true, Touch = true, DeviceScaleFactor = 2, MaxTouchPoints = 5,
                UserAgentProfile = "mobile",
            });
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "navigator.maxTouchPoints >= 1", "true");
        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "window.devicePixelRatio >= 1", "true");
    }

    [MotorAssertFact]
    public async Task C12_text_input_reaches_focused_field()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/click-target", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await act.SendClickAsync(200, 216);
        await act.SendTextAsync("hello");
        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "window.__SPECULUM_INPUT__ || ''", "hello");
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

        await fx.Diagnostics.WaitFixturePageAsync(act.ConnectionId!, "popup");
        // Open button is naturally near top-left of content; click generous hit box via eval fallback if needed.
        await act.EvalJsAsync(42, "document.getElementById('open')?.click(); document.getElementById('blank')?.click();");

        var status = await act.WaitForStatusAsync(s => s.TabCount == 1, TimeSpan.FromSeconds(20));
        Assert.Equal(1, status.TabCount);

        var probe = await fx.Diagnostics.PostBrowserProbeAsync(act.ConnectionId!, ["tabs"]);
        Assert.True(probe.GetProperty("ok").GetBoolean());
        var tabs = DiagnosticsAssertClient.RequireProperty(probe, "data");
        // Enforce single live page: tabCount field or array length <= 1.
        if (tabs.ValueKind == JsonValueKind.Object && tabs.TryGetProperty("tabCount", out var tc))
            Assert.Equal(1, tc.GetInt32());
        else if (tabs.ValueKind == JsonValueKind.Object && tabs.TryGetProperty("tabs", out var arr) && arr.ValueKind == JsonValueKind.Array)
            Assert.True(arr.GetArrayLength() <= 1, tabs.ToString());
        else if (tabs.ValueKind == JsonValueKind.Array)
            Assert.True(tabs.GetArrayLength() <= 1, tabs.ToString());
        else
            Assert.Equal(1, status.TabCount); // fall back to Status channel contract
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

        await fx.Diagnostics.WaitFixturePageAsync(act.ConnectionId!, "home");
        await act.EvalJsAsync(7, "window.__SPECULUM_EVAL__ = 'via-console-input';");
        await fx.Diagnostics.WaitEvaluateContainsAsync(
            act.ConnectionId!, "window.__SPECULUM_EVAL__", "via-console-input");
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

        await fx.Diagnostics.WaitFixturePageAsync(act.ConnectionId!, "external-link");
        await act.EvalJsAsync(9, "window.goEvil && window.goEvil()");

        var session = await fx.Diagnostics.TryGetSessionAsync(act.ConnectionId!);
        Assert.Equal("Running", session!.Value.GetProperty("snapshot").GetProperty("phase").GetString());

        var status = await act.WaitForStatusAsync(s => s.TabCount == 1, TimeSpan.FromSeconds(20));
        Assert.Equal(1, status.TabCount);
        Assert.DoesNotContain("evil-fixture", status.Url, StringComparison.OrdinalIgnoreCase);
    }
}
