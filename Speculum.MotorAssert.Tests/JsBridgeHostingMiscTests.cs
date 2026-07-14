using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

[Collection(nameof(MotorAssertCollection))]
[Trait("Category", "MotorAssertive")]
public sealed class JsBridgeHostingMiscTests(MotorAssertFixture fx)
{
    [MotorAssertFact]
    public async Task I1_js_bridge_enabled_on_snapshot()
    {
        await fx.Host.PutConfigAsync("JsBridge", new { enable = true });
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/console-noise", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var session = await fx.Diagnostics.RequireSessionAsync(act.ConnectionId!);
        var snap = fx.Diagnostics.RequireSnapshot(session);
        Assert.True(fx.Diagnostics.RequireBool(snap, "jsBridgeEnabled"));
    }

    [MotorAssertFact]
    public async Task I3_js_bridge_disabled_reflected_on_new_session()
    {
        await fx.Host.PutConfigAsync("JsBridge", new { enable = false });
        try
        {
            var since = DateTimeOffset.UtcNow.AddSeconds(-2);
            var actId = Guid.NewGuid().ToString("N");
            await using var act = new MotorActClient(fx.Host);
            await act.ConnectAsync();
            await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/home", actId);
            await fx.Diagnostics.WaitForEventsAsync(
                act.ConnectionId, "Motor.Session", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

            var session = await fx.Diagnostics.RequireSessionAsync(act.ConnectionId!);
            var snap = fx.Diagnostics.RequireSnapshot(session);
            Assert.False(fx.Diagnostics.RequireBool(snap, "jsBridgeEnabled"));
        }
        finally
        {
            await fx.Host.PutConfigAsync("JsBridge", new { enable = true });
        }
    }

    [MotorAssertFact]
    public async Task J7_mirroring_without_edge_tls_is_rejected()
    {
        var put = await fx.Host.PutConfigAsync("Hosting", new
        {
            profiles = new object[]
            {
                new
                {
                    domain = "speculum.test",
                    subdomainMirroringEnabled = true,
                },
            },
        });
        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
        var body = await put.Content.ReadAsStringAsync();
        Assert.Contains("edgeTls", body, StringComparison.OrdinalIgnoreCase);
    }

    [MotorAssertFact]
    public async Task A2_not_ready_when_hosting_wiped_then_restore()
    {
        var del = await fx.Host.DeleteConfigAsync("Hosting");
        Assert.True(del.IsSuccessStatusCode);

        try
        {
            HttpResponseMessage? ready = null;
            for (var i = 0; i < 15; i++)
            {
                ready = await fx.Host.Http.GetAsync("/ready");
                if (!ready.IsSuccessStatusCode)
                    break;
                await Task.Delay(300);
            }

            Assert.False(ready!.IsSuccessStatusCode, "expected /ready to fail without Hosting");
        }
        finally
        {
            var restore = await fx.RestoreHostingApexAsync();
            restore.EnsureSuccessStatusCode();
            var recovered = false;
            for (var i = 0; i < 30; i++)
            {
                var ready = await fx.Host.Http.GetAsync("/ready");
                if (ready.IsSuccessStatusCode)
                {
                    recovered = true;
                    break;
                }

                await Task.Delay(400);
            }

            Assert.True(recovered, "/ready did not recover after Hosting restore");
        }
    }

    [MotorAssertFact]
    public async Task O5_delete_forwarding_makes_not_ready_then_reseed()
    {
        var del = await fx.Host.DeleteConfigAsync("Forwarding");
        Assert.True(del.IsSuccessStatusCode);

        try
        {
            HttpResponseMessage? ready = null;
            for (var i = 0; i < 15; i++)
            {
                ready = await fx.Host.Http.GetAsync("/ready");
                if (!ready.IsSuccessStatusCode)
                    break;
                await Task.Delay(300);
            }

            Assert.False(ready!.IsSuccessStatusCode);
        }
        finally
        {
            var put = await fx.RestoreForwardingAsync();
            put.EnsureSuccessStatusCode();
            var recovered = false;
            for (var i = 0; i < 30; i++)
            {
                var ready = await fx.Host.Http.GetAsync("/ready");
                if (ready.IsSuccessStatusCode)
                {
                    recovered = true;
                    break;
                }

                await Task.Delay(400);
            }

            Assert.True(recovered, "/ready did not recover after Forwarding reseed");
        }
    }

    [MotorAssertFact]
    public async Task J3_hosting_status_endpoint()
    {
        var res = await fx.Host.Http.GetAsync("api/admin/config/status");
        res.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.ValueKind is JsonValueKind.Object or JsonValueKind.Array);
    }
}
