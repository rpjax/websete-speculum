using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

/// <summary>
/// T1–T2: proves the composite <c>Telemetry.SampleCollected</c> sample carries every section
/// (host / motor / sidecar / persistence / pipeline) end-to-end, and that a live motor session
/// is reflected in the motor + sidecar aggregates. Symptom→signal contract of docs/diagnostics.md.
/// </summary>
[Collection(nameof(MotorAssertCollection))]
[Trait("Category", "MotorAssertive")]
public sealed class TelemetrySampleDeepTests : MotorAssertTestBase
{
    public TelemetrySampleDeepTests(MotorAssertFixture fixture) : base(fixture) { }

    [MotorAssertFact]
    public async Task T1_composite_sample_has_all_sections()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-1);

        var sample = await fx.Diagnostics.WaitTelemetrySampleAsync(since);

        // host — memory / GC / threadpool signals.
        var host = DiagnosticsAssertClient.RequireProperty(sample, "host");
        Assert.False(string.IsNullOrWhiteSpace(host.GetProperty("hostname").GetString()));
        Assert.True(host.GetProperty("memoryUsed").GetInt64() > 0);
        Assert.True(host.GetProperty("memoryTotal").GetInt64() > 0);
        DiagnosticsAssertClient.RequireProperty(host, "cpuUsage");
        DiagnosticsAssertClient.RequireProperty(host, "gcGen2");
        DiagnosticsAssertClient.RequireProperty(host, "threadPoolQueued");

        // motor — capacity / fps / queue signals.
        var motor = DiagnosticsAssertClient.RequireProperty(sample, "motor");
        DiagnosticsAssertClient.RequireProperty(motor, "total");
        DiagnosticsAssertClient.RequireProperty(motor, "byPhase");
        DiagnosticsAssertClient.RequireProperty(motor, "avgFps");
        DiagnosticsAssertClient.RequireProperty(motor, "capacityUsedPct");
        Assert.Equal(4, motor.GetProperty("capacityMax").GetInt32());

        // sidecar — instability signal.
        var sidecar = DiagnosticsAssertClient.RequireProperty(sample, "sidecar");
        DiagnosticsAssertClient.RequireProperty(sidecar, "connected");
        DiagnosticsAssertClient.RequireProperty(sidecar, "faulted");

        // persistence — store footprint.
        var persistence = DiagnosticsAssertClient.RequireProperty(sample, "persistence");
        DiagnosticsAssertClient.RequireProperty(persistence, "storedSessions");
        DiagnosticsAssertClient.RequireProperty(persistence, "expiringSoon");

        // pipeline — diagnostics back-pressure.
        var pipeline = DiagnosticsAssertClient.RequireProperty(sample, "pipeline");
        Assert.True(pipeline.GetProperty("storageMaxBytes").GetInt64() > 0);
        DiagnosticsAssertClient.RequireProperty(pipeline, "usedPct");
        DiagnosticsAssertClient.RequireProperty(pipeline, "recentSlowWrites");
        DiagnosticsAssertClient.RequireProperty(pipeline, "elevateActive");
    }

    [MotorAssertFact]
    public async Task T2_live_session_reflected_in_motor_and_sidecar_aggregates()
    {
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        var startSince = DateTimeOffset.UtcNow.AddSeconds(-2);
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/home", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", startSince,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var since = DateTimeOffset.UtcNow.AddSeconds(-1);
        var sample = await fx.Diagnostics.WaitTelemetrySampleAsync(
            since,
            payload => payload.TryGetProperty("motor", out var m)
                && m.TryGetProperty("total", out var total)
                && total.GetInt32() >= 1);

        var motor = DiagnosticsAssertClient.RequireProperty(sample, "motor");
        Assert.True(motor.GetProperty("total").GetInt32() >= 1);

        // Assertive opt-ins on: identity + per-session projections present.
        var liveIds = DiagnosticsAssertClient.RequireProperty(motor, "liveSessionIds");
        Assert.Equal(JsonValueKind.Array, liveIds.ValueKind);
        Assert.NotEmpty(liveIds.EnumerateArray());
        var sessions = DiagnosticsAssertClient.RequireProperty(motor, "sessions");
        Assert.Equal(JsonValueKind.Array, sessions.ValueKind);
        Assert.NotEmpty(sessions.EnumerateArray());

        var sidecar = DiagnosticsAssertClient.RequireProperty(sample, "sidecar");
        Assert.True(sidecar.GetProperty("connected").GetInt32() >= 1);

        var connId = act.ConnectionId!;
        await act.DisconnectAsync();
        await fx.Diagnostics.WaitForEventsAsync(
            connId, "Motor.Session", startSince,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStopped"));
        await fx.Diagnostics.AssertSessionGoneAsync(connId);
    }
}
