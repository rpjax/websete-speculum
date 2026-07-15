using System.Diagnostics;
using System.Net.Http.Json;
using Speculum.MotorAssert.Tests;

namespace Speculum.MotorPerf.Tests;

/// <summary>
/// Capacity / SLO checks. Failures mean regression against documented floors — not functional correctness.
/// </summary>
[Trait("Category", "MotorPerf")]
public sealed class MotorPerfSloTests
{
    private readonly MotorAssertHost _host = new();
    private readonly DiagnosticsAssertClient _diag;

    public MotorPerfSloTests() => _diag = new DiagnosticsAssertClient(_host);

    [MotorPerfFact]
    public async Task Overflow_under_load_emits_StorageOverflow()
    {
        var put = await _host.PutConfigAsync("Diagnostics", new
        {
            enabled = true,
            profile = "Assertive",
            domains = new
            {
                motor = new { metrics = true, events = true, snapshots = true },
                sidecar = new { metrics = true, events = true },
                browserQuery = new { probe = true },
                persisted = new { snapshots = true },
            },
            probe = new
            {
                maxConcurrentProbesPerSession = 2,
                diagTimeoutMs = 10000,
                maxProbeResponseBytes = 524288,
            },
            storage = new { maxBytes = 8192, ttlHours = 24, overflow = "DropOldest" },
        });
        put.EnsureSuccessStatusCode();

        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        try
        {
            for (var i = 0; i < 20; i++)
            {
                await using var act = new MotorActClient(_host);
                await act.ConnectAsync();
                await act.StartSessionAsync(
                    $"{_host.FixtureClientOrigin}/home",
                    Guid.NewGuid().ToString("N"));
                await Task.Delay(50);
                await act.DisconnectAsync();
            }

            await _diag.WaitForEventsAsync(
                null, "Diagnostics.Storage", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Diagnostics.StorageOverflow"),
                timeout: TimeSpan.FromSeconds(90));
        }
        finally
        {
            await _host.PutConfigAsync("Diagnostics", Speculum.MotorAssert.Tests.MotorAssertFixture.AssertiveDiagnosticsConfig());
        }
    }

    [MotorPerfFact]
    public async Task Frame_sequence_grows_above_slo_floor()
    {
        // SLO: within 8s of Running, frameSequence >= 2 (idle screencast path).
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(_host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{_host.FixtureClientOrigin}/home", actId);
        await _diag.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var sw = Stopwatch.StartNew();
        await _diag.WaitFrameSequenceAtLeastAsync(act.ConnectionId!, 2, TimeSpan.FromSeconds(8));
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(8), $"FPS/frame SLO missed: {sw.Elapsed}");
    }

    [MotorPerfFact]
    public async Task Probe_storm_surfaces_busy_without_deadlock()
    {
        await _host.PutConfigAsync("Diagnostics", new
        {
            enabled = true,
            profile = "Assertive",
            domains = new
            {
                motor = new { metrics = true, events = true, snapshots = true },
                sidecar = new { metrics = true, events = true },
                browserQuery = new { probe = true },
                persisted = new { snapshots = true },
            },
            probe = new
            {
                maxConcurrentProbesPerSession = 1,
                diagTimeoutMs = 8000,
                maxProbeResponseBytes = 524288,
            },
        });

        try
        {
            var since = DateTimeOffset.UtcNow.AddSeconds(-2);
            var actId = Guid.NewGuid().ToString("N");
            await using var act = new MotorActClient(_host);
            await act.ConnectAsync();
            await act.StartSessionAsync($"{_host.FixtureClientOrigin}/home", actId);
            await _diag.WaitForEventsAsync(
                act.ConnectionId, "Motor.Session", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

            var tasks = Enumerable.Range(0, 8).Select(_ =>
                _host.Http.PostAsJsonAsync(
                    $"api/admin/diagnostics/v1/sessions/{act.ConnectionId}/browser",
                    new
                    {
                        ops = new[] { "evaluate" },
                        evaluateExpression = "await new Promise(r => setTimeout(r, 400)); 'ok'",
                        correlationId = Guid.NewGuid().ToString("N"),
                    },
                    MotorAssertHost.Json)).ToArray();

            var results = await Task.WhenAll(tasks);
            Assert.Contains(results, r => (int)r.StatusCode == 429);
            Assert.All(results, r => Assert.True(
                r.IsSuccessStatusCode || (int)r.StatusCode is 429 or 504,
                $"unexpected {(int)r.StatusCode}"));
        }
        finally
        {
            await _host.PutConfigAsync("Diagnostics", Speculum.MotorAssert.Tests.MotorAssertFixture.AssertiveDiagnosticsConfig());
        }
    }
}
