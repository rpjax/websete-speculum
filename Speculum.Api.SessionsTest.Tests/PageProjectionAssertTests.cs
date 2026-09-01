namespace Speculum.SessionsTest.Tests;

/// <summary>
/// MATRIX PP1–PP4 — product MirrorMode.PageProjection effect asserts.
/// Not VideoStreamingInput. C* rows remain legacy Video with explicit MirrorMode.
/// </summary>
[Collection(nameof(SessionsTestCollection))]
[Trait("Category", "PageProjection")]
[Trait("Category", "SessionsTest")]
public sealed class PageProjectionAssertTests : SessionsTestBase
{
    public PageProjectionAssertTests(SessionsTestFixture fixture) : base(fixture) { }

    public override async Task InitializeAsync()
    {
        await base.InitializeAsync();
        await Fx.EnsureSessionsMirrorModeAsync("pageProjection");
    }

    [SessionsTestFact]
    public async Task PP1_start_emits_frame_with_body_context_and_sequence()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        var started = await act.StartFixturePageAsync("/click-target");
        Assert.Equal("pageProjection", started.MirrorMode, ignoreCase: true);

        var frame = await act.WaitPageProjectionFrameAsync(timeoutMs: 60_000);
        Assert.True(frame.BodyLen > 0, $"expected frame body, bodyLen={frame.BodyLen}");
        Assert.True(frame.Sequence >= 1, $"expected sequence>=1, got {frame.Sequence}");
        Assert.True(frame.ContextId >= 1, $"expected contextId>=1, got {frame.ContextId}");
    }

    [SessionsTestFact]
    public async Task PP2_intent_click_increments_fixture_counter()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target");

        await act.WaitEvaluateContainsAsync(
            "document.getElementById('out')?.getAttribute('data-clicks')", "0");

        // Wait until Virtual producer can resolve #btn (first frames must have seeded the map).
        await act.WaitPageProjectionFrameAsync(timeoutMs: 60_000);
        await act.ResolveAndClickAsync("#btn");

        await act.WaitEvaluateContainsAsync(
            "document.getElementById('out')?.getAttribute('data-clicks')", "1");
    }

    [SessionsTestFact]
    public async Task PP3_resync_delivers_resync_frame_and_keeps_virtual_armed()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target");

        _ = await act.WaitPageProjectionFrameAsync(timeoutMs: 60_000);

        act.ClearJournal();

        // Open the Diff consumer *before* RequestResync so the resync-flagged frame is not missed.
        var frameTask = act.WaitPageProjectionFrameAsync(
            requireResync: true,
            timeoutMs: 60_000);
        await Task.Delay(400);
        await act.RequestPageProjectionResyncAsync(contextId: 1, reason: "sessions-test-pp3");

        await act.WaitJournalAsync(
            "Telemetry.Sessions.PageProjection.Frame.ResyncRequested",
            TimeSpan.FromSeconds(15));

        var resync = await frameTask;
        Assert.True(resync.Resync, "expected resync flag on frame");
        Assert.True(resync.BodyLen > 0, $"expected resync body, bodyLen={resync.BodyLen}");

        // Virtual still usable after resync (Projected arm is SPA; Virtual evaluate is the SessionsTest oracle).
        await act.WaitEvaluateContainsAsync(
            "document.getElementById('out')?.getAttribute('data-clicks')", "0");
        await act.WaitEvaluateContainsAsync("document.readyState", "complete");
    }

    [SessionsTestFact]
    public async Task PP4_off_allowlist_nav_redirects_and_journals_blocked()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/external-link");

        _ = await act.WaitPageProjectionFrameAsync(timeoutMs: 60_000);

        act.ClearJournal();
        act.ClearRedirects();

        await act.EvaluateAsync("window.goEvil(); 'ok'");

        await act.WaitJournalAsync(
            "Sessions.MainFrameNavigationBlocked",
            TimeSpan.FromSeconds(20),
            predicate: f =>
                f.Payload is not null
                && f.Payload.Contains("evil-fixture", StringComparison.OrdinalIgnoreCase));

        await act.WaitRedirectAsync(
            TimeSpan.FromSeconds(20),
            predicate: url => url.Contains("evil-fixture", StringComparison.OrdinalIgnoreCase)
                || url.Contains("fixture.test", StringComparison.OrdinalIgnoreCase));
    }

    [SessionsTestFact]
    public async Task B5_2_profile_ls_idb_round_trip_after_stop_export()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        var profileId = await act.EnsureProfileAsync();

        await act.StartFixturePageAsync("/", profileId: profileId);
        await act.WaitFixtureHomeStorageSeededAsync();

        act.ClearJournal();
        await act.StopSessionAsync();
        await act.WaitJournalAsync("Sessions.SessionStatePersisted", TimeSpan.FromSeconds(30));

        var exported = await act.GetProfileAsync(profileId);
        Assert.True(exported.LocalStorageCount >= 1,
            $"expected exported LS count>=1, got {exported.LocalStorageCount}");
        Assert.True(exported.IdbRecordCount >= 1,
            $"expected exported IDB count>=1, got {exported.IdbRecordCount}");

        act.ClearJournal();
        await act.StartFixturePageAsync("/", profileId: profileId);
        await act.WaitJournalAsync("Sessions.ProfileStateRestored", TimeSpan.FromSeconds(45));

        await act.WaitEvaluateContainsAsync("localStorage.getItem('sf_ls')", "home-ls");
        await act.WaitEvaluateContainsAsync(SessionsActClient.FixtureIdbReadExpression, "home-idb");
    }

    [SessionsTestFact]
    public async Task B5_3_permission_gate_default_deny_registered_grant_allows()
    {
        await using var denyAct = new SessionsActClient(Fx.Host);
        await denyAct.ConnectAsync();
        await denyAct.StartFixturePageAsync("/permissions");

        await denyAct.WaitEvaluateContainsAsync(
            "document.getElementById('out')?.getAttribute('data-camera')",
            "denied");
        await denyAct.WaitEvaluateContainsAsync(
            "document.getElementById('out')?.getAttribute('data-microphone')",
            "denied");

        await using var allowAct = new SessionsActClient(Fx.Host);
        await allowAct.ConnectAsync();
        await allowAct.StartFixturePageAsync("/permissions");
        await allowAct.WaitEvaluateContainsAsync("location.href", "fixture.test");
        var grant = await allowAct.RegisterPermissionGrantAsync(camera: true, microphone: true);
        Assert.True(grant.GetProperty("ok").GetBoolean());
        Assert.Equal("Allow", grant.GetProperty("cameraPolicy").GetString());
        Assert.Equal("Allow", grant.GetProperty("microphonePolicy").GetString());
        var resync = await allowAct.ProbeAsync(["resyncPermissions"]);
        Assert.Equal("allow", resync.GetProperty("resyncPermissions").GetProperty("camera").GetString());
        Assert.Equal("allow", resync.GetProperty("resyncPermissions").GetProperty("microphone").GetString());
        await allowAct.EvaluateAsync("window.__SPECULUM_PERMISSION_PROBE__()");
        await allowAct.WaitEvaluateContainsAsync(
            "document.getElementById('out')?.getAttribute('data-camera')",
            "granted");
        await allowAct.WaitEvaluateContainsAsync(
            "document.getElementById('out')?.getAttribute('data-microphone')",
            "granted");
    }

    [SessionsTestFact]
    public async Task B5_4_sessions_cpu_profiling_flag_propagates_and_probes_registered()
    {
        await Fx.EnsureSessionsCpuProfilingAsync(enabled: true);

        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        await act.StartFixturePageAsync("/click-target");

        var data = await act.ProbeAsync(["startCpuProfile"]);
        var cpu = data.GetProperty("startCpuProfile");
        Assert.True(cpu.GetProperty("ok").GetBoolean(),
            $"startCpuProfile probe failed: {cpu}");
    }

    [SessionsTestFact]
    public async Task PP5_restore_profile_ls_idb_asserts_counts()
    {
        await using var act = new SessionsActClient(Fx.Host);
        await act.ConnectAsync();
        var profileId = await act.EnsureProfileAsync();

        await act.StartFixturePageAsync("/", profileId: profileId);
        await act.WaitFixtureHomeStorageSeededAsync();

        act.ClearJournal();
        await act.StopSessionAsync();
        await act.WaitJournalAsync("Sessions.SessionStatePersisted", TimeSpan.FromSeconds(30));

        var profile = await act.GetProfileAsync(profileId);
        Assert.True(profile.LocalStorageCount >= 1,
            $"expected profile localStorageCount>=1, got {profile.LocalStorageCount}");
        Assert.True(profile.IdbRecordCount >= 1,
            $"expected profile idbRecordCount>=1, got {profile.IdbRecordCount}");
    }
}
