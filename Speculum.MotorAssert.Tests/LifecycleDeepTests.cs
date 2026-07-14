using System.Net.Http.Json;
using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

[Collection(nameof(MotorAssertCollection))]
[Trait("Category", "MotorAssertive")]
public sealed class LifecycleDeepTests : MotorAssertTestBase
{
    public LifecycleDeepTests(MotorAssertFixture fixture) : base(fixture) { }

    [MotorAssertFact]
    public async Task A4_second_start_promotes_new_session()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId1 = Guid.NewGuid().ToString("N");
        var actId2 = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();

        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/home", actId1);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId1));

        var replaceSince = DateTimeOffset.UtcNow.AddSeconds(-1);
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/nav/a", actId2);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", replaceSince,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId2));

        await fx.Diagnostics.ExpectEvaluateAsync(
            act.ConnectionId!,
            "document.getElementById('speculum-probe')?.dataset?.page",
            "nav-a");
    }

    [MotorAssertFact]
    public async Task A5_cancel_starting_releases_slot()
    {
        var (baselineActive, _) = await fx.Diagnostics.GetRegistryCountsAsync();

        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();

        var start = act.StartSessionAsync(
            $"{fx.Host.FixtureClientOrigin}/home",
            Guid.NewGuid().ToString("N"));

        await Task.Delay(80);
        await act.DisconnectAsync();

        try { await start; }
        catch { /* Start may fault when connection drops mid-Starting */ }

        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(45);
        while (DateTime.UtcNow < deadline)
        {
            var (active, starting) = await fx.Diagnostics.GetRegistryCountsAsync();
            if (active <= baselineActive && starting == 0)
                return;
            await Task.Delay(250);
        }

        var final = await fx.Diagnostics.GetRegistryCountsAsync();
        Assert.True(final.ActiveCount <= baselineActive, $"ActiveCount leak: {final.ActiveCount} > {baselineActive}");
        Assert.Equal(0, final.StartingCount);
    }

    [MotorAssertFact]
    public async Task A6_disconnect_exports_and_persists()
    {
        var token = MotorAssertTokens.Fixed("persist-a6-export");
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");

        await using (var act = new MotorActClient(fx.Host))
        {
            await act.ConnectAsync();
            await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/set-state", actId, clientToken: token);
            await fx.Diagnostics.WaitForEventsAsync(
                act.ConnectionId, "Motor.Session", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));
            await fx.Diagnostics.WaitCookieAsync(act.ConnectionId!, "sf_marker", "state-cookie");
            var exportSince = DateTimeOffset.UtcNow.AddSeconds(-1);
            var connId = act.ConnectionId!;
            await act.DisconnectAsync();
            await fx.Diagnostics.WaitStateExportCompletedAsync(connId, exportSince);
        }

        var list = await fx.Host.Http.GetFromJsonAsync<JsonElement>("api/admin/diagnostics/v1/persisted");
        Assert.True(list.GetArrayLength() >= 1);
        var found = list.EnumerateArray().Any(item =>
            item.TryGetProperty("clientToken", out var ct)
            && string.Equals(ct.GetString(), token, StringComparison.Ordinal));
        Assert.True(found, "persisted row for A6 clientToken missing");
    }

    [MotorAssertFact]
    public async Task A8_sidecar_stop_faults_and_cleans_session()
    {
        var composeFile = ResolveComposeFile();
        if (composeFile is null)
        {
            // Local without compose CLI: skip only when we cannot reach docker.
            Assert.Fail("MOTOR_ASSERT compose file not found; A8 requires docker compose sidecar control");
        }

        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        string? connId = null;

        try
        {
            await using var act = new MotorActClient(fx.Host);
            await act.ConnectAsync();
            await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/home", actId);
            await fx.Diagnostics.WaitForEventsAsync(
                act.ConnectionId, "Motor.Session", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));
            connId = act.ConnectionId;

            RunCompose(composeFile, "stop", "sidecar");

            // Prefer fault signal while session is still live; export-fail is also correct if disconnect races.
            await fx.Diagnostics.WaitForEventsAsync(
                connId, "Motor.", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SidecarFaulted"),
                timeout: TimeSpan.FromSeconds(90));
        }
        finally
        {
            RunCompose(composeFile!, "start", "sidecar");
            await MotorAssertCompose.WaitSidecarHttpHealthyAsync(composeFile!);
            await fx.Host.EnsureReadyAsync();
        }

        if (connId is not null)
            await fx.Diagnostics.AssertSessionGoneAsync(connId);
    }

    private static string? ResolveComposeFile()
    {
        var candidates = new[]
        {
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "deploy", "compose", "docker-compose.motor-assert.yml")),
            Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "deploy", "compose", "docker-compose.motor-assert.yml")),
            Environment.GetEnvironmentVariable("MOTOR_ASSERT_COMPOSE_FILE"),
        };
        return candidates.FirstOrDefault(p => !string.IsNullOrWhiteSpace(p) && File.Exists(p!));
    }

    private static void RunCompose(string composeFile, params string[] args)
        => MotorAssertCompose.Run(composeFile, args);
}
