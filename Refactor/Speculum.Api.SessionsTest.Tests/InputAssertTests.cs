using Speculum.Api.Sessions.Models;

namespace Speculum.SessionsTest.Tests;

/// <summary>
/// MATRIX C1–C12 input effect asserts against motor-fixture via Refactor SessionHub +
/// sessions harness HTTP admit (product input is data-plane VideoStreamingInput; harness
/// calls AdmitVideoStreamingInput directly). Journal InputApplied enabled only via explicit seed.
/// </summary>
[Collection(nameof(SessionsTestCollection))]
[Trait("Category", "SessionsTest")]
public sealed class InputAssertTests : SessionsTestBase
{
    public InputAssertTests(SessionsTestFixture fixture) : base(fixture) { }

    private static DeviceProfile MobileDevice => new()
    {
        Mobile = true,
        Touch = true,
        DeviceScaleFactor = 2,
        MaxTouchPoints = 5,
        UserAgentProfile = "mobile",
        DeviceCategory = "phone",
    };

    [SessionsTestFact]
    public async Task C1_mouse_click_increments_fixture_counter()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target");

        await act.WaitEvaluateContainsAsync(
            "document.getElementById('out')?.getAttribute('data-clicks')", "0");
        await act.SendClickAsync(200, 140);
        await act.WaitEvaluateContainsAsync(
            "document.getElementById('out')?.getAttribute('data-clicks')", "1");
        await act.WaitJournalAsync("Telemetry.Sessions.VideoStreamingInput.Applied", TimeSpan.FromSeconds(10));
    }

    [SessionsTestFact]
    public async Task C2_keydown_reaches_fixture()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target");

        await act.SendClickAsync(200, 216);
        await act.SendKeyAsync("a");
        await act.WaitEvaluateContainsAsync("window.__SPECULUM_LAST_KEY__ || ''", "a");
    }

    [SessionsTestFact]
    public async Task C3_wheel_sets_fixture_flag()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target");

        await act.SendWheelAsync(400, 300, 160);
        await act.WaitEvaluateContainsAsync("window.__SPECULUM_WHEEL__ === true", "true");
    }

    [SessionsTestFact]
    public async Task C4_invalid_input_type_does_not_mutate_page()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target");

        await act.WaitEvaluateContainsAsync(
            "document.getElementById('out')?.getAttribute('data-clicks')", "0");
        await act.SendInputAsync("paste", """{"type":"paste","text":"nope"}""");
        await act.WaitJournalAsync("Telemetry.Sessions.VideoStreamingInput.Rejected", TimeSpan.FromSeconds(10));

        var before = await act.EvaluateAsync(
            "document.getElementById('out')?.getAttribute('data-clicks')");
        Assert.Contains("0", before, StringComparison.Ordinal);

        await act.SendClickAsync(200, 140);
        await act.WaitEvaluateContainsAsync(
            "document.getElementById('out')?.getAttribute('data-clicks')", "1");
    }

    [SessionsTestFact]
    public async Task C5_malformed_json_input_is_ignored()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target");

        await act.SendInputAsync("mousedown", "{not-json");
        await act.WaitJournalAsync("Telemetry.Sessions.VideoStreamingInput.Rejected", TimeSpan.FromSeconds(10));

        await act.SendClickAsync(200, 140);
        await act.WaitEvaluateContainsAsync(
            "document.getElementById('out')?.getAttribute('data-clicks')", "1");
    }

    [SessionsTestFact]
    public async Task C6_touch_tap_increments_fixture_counter()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target", device: MobileDevice);

        await act.WaitEvaluateContainsAsync(
            "document.getElementById('out')?.getAttribute('data-clicks')", "0");
        await act.SendTouchTapAsync(200, 140);
        await act.WaitEvaluateContainsAsync(
            "document.getElementById('out')?.getAttribute('data-clicks')", "1");
    }

    [SessionsTestFact]
    public async Task C7_touch_cancel_does_not_click()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target", device: MobileDevice);

        var point = new SessionsActClient.TouchPointWire(1, 200, 140);
        await act.SendTouchAsync("start", [point], [1]);
        await act.SendTouchAsync("cancel", [], [1]);
        await act.WaitEvaluateContainsAsync(
            "window.__SPECULUM_TOUCH__?.cancels >= 1", "true");
        await act.WaitEvaluateContainsAsync(
            "document.getElementById('out')?.getAttribute('data-clicks')", "0");
    }

    [SessionsTestFact]
    public async Task C8_multitouch_reports_two_points()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target", device: MobileDevice);

        var p1 = new SessionsActClient.TouchPointWire(1, 180, 140);
        var p2 = new SessionsActClient.TouchPointWire(2, 220, 140);
        await act.SendTouchAsync("start", [p1], [1]);
        await act.SendTouchAsync("start", [p1, p2], [2]);
        await act.WaitEvaluateContainsAsync(
            "window.__SPECULUM_TOUCH__?.maxPoints >= 2", "true");
        await act.SendTouchAsync("end", [], [1, 2]);
    }

    [SessionsTestFact]
    public async Task C9_input_rejected_emits_journal_then_click_works()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target");

        await act.SendInputAsync("paste", """{"type":"paste","text":"x"}""");
        await act.WaitJournalAsync(
            "Telemetry.Sessions.VideoStreamingInput.Rejected",
            TimeSpan.FromSeconds(10),
            predicate: f =>
                f.Payload is not null
                && f.Payload.Contains("input_invalid", StringComparison.Ordinal));

        await act.SendClickAsync(200, 140);
        await act.WaitEvaluateContainsAsync(
            "document.getElementById('out')?.getAttribute('data-clicks')", "1");
    }

    [SessionsTestFact]
    public async Task C10_touch_scroll_moves_scrollTop()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/touch-scroll", device: MobileDevice);

        await act.WaitEvaluateContainsAsync(
            "document.getElementById('speculum-probe')?.getAttribute('data-page')",
            "touch-scroll");

        const int id = 1;
        await act.SendTouchAsync(
            "start",
            [new SessionsActClient.TouchPointWire(id, 200, 400)],
            [id]);
        for (var y = 380; y >= 120; y -= 40)
        {
            await act.SendTouchAsync(
                "move",
                [new SessionsActClient.TouchPointWire(id, 200, y)],
                [id]);
        }

        await act.SendTouchAsync("end", [], [id]);
        await act.WaitEvaluateContainsAsync("window.__SPECULUM_SCROLL__ > 20", "true");
    }

    [SessionsTestFact]
    public async Task C11_mobile_device_profile_sets_maxTouchPoints()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target", device: MobileDevice);

        await act.WaitEvaluateContainsAsync("navigator.maxTouchPoints >= 1", "true");
        await act.WaitEvaluateContainsAsync("window.devicePixelRatio >= 1", "true");
    }

    [SessionsTestFact]
    public async Task C12_text_input_reaches_focused_field()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target");

        await act.SendClickAsync(200, 216);
        await act.SendTextAsync("hello");
        await act.WaitEvaluateContainsAsync("window.__SPECULUM_INPUT__ || ''", "hello");
    }
}
