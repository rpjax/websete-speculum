using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

[Collection(nameof(MotorAssertCollection))]
[Trait("Category", "MotorAssertive")]
public sealed class PersistenceDrainInjectionTests : MotorAssertTestBase
{
    public PersistenceDrainInjectionTests(MotorAssertFixture fixture) : base(fixture) { }

    [MotorAssertFact]
    public async Task E1_E2_persistence_export_and_restore_via_client_token()
    {
        var token = MotorAssertTokens.Fixed("persist-e1-e2");
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");

        await using (var act = new MotorActClient(fx.Host))
        {
            await act.ConnectAsync();
            await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/set-state", actId, clientToken: token);
            await fx.Diagnostics.WaitForEventsAsync(
                act.ConnectionId, "Motor.Session", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

            await fx.Diagnostics.ExpectCookieAsync(act.ConnectionId!, "sf_marker", "state-cookie");
            await fx.Diagnostics.ExpectLocalStorageAsync(act.ConnectionId!, "sf_ls", "state-ls");
            var exportSince = DateTimeOffset.UtcNow.AddSeconds(-1);
            var connId = act.ConnectionId!;
            await act.DisconnectAsync();
            await fx.Diagnostics.WaitStateExportCompletedAsync(connId, exportSince);
        }

        var list = await fx.Host.Http.GetFromJsonAsync<JsonElement>("api/admin/diagnostics/v1/persisted");
        Assert.True(list.GetArrayLength() >= 1);

        var since2 = DateTimeOffset.UtcNow.AddSeconds(-1);
        var actId2 = Guid.NewGuid().ToString("N");
        await using var act2 = new MotorActClient(fx.Host);
        await act2.ConnectAsync();
        await act2.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/nav/a", actId2, clientToken: token);
        await fx.Diagnostics.WaitForEventsAsync(
            act2.ConnectionId, "Motor.Session", since2,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId2));

        await fx.Diagnostics.ExpectCookieAsync(act2.ConnectionId!, "sf_marker", "state-cookie");
        await fx.Diagnostics.ExpectLocalStorageAsync(act2.ConnectionId!, "sf_ls", "state-ls");
    }

    [MotorAssertFact]
    public async Task G2_drain_on_forwarding_put()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var drainSince = DateTimeOffset.UtcNow.AddSeconds(-1);
        var put = await fx.Host.PutConfigAsync("Forwarding", new
        {
            host = "fixture.test",
            domains = new[] { "fixture.test", "*.fixture.test" },
        });
        put.EnsureSuccessStatusCode();

        await fx.Diagnostics.WaitForEventsAsync(
            null, "Motor.Drain", drainSince,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.DrainStarted")
                  && DiagnosticsAssertClient.HasEvent(ev, "Motor.DrainCompleted"));
    }

    [MotorAssertFact]
    public async Task H2_script_injection_sets_marker()
    {
        var scriptBody = "window.__SPECULUM_INJECTED__ = 'motor-assert-ok';";
        using var content = new MultipartFormDataContent();
        content.Add(new ByteArrayContent(Encoding.UTF8.GetBytes(scriptBody)), "file", "marker.js");

        var upload = await fx.Host.Http.PostAsync("api/admin/scripts", content);
        upload.EnsureSuccessStatusCode();
        using var uploaded = JsonDocument.Parse(await upload.Content.ReadAsStringAsync());
        var scriptId = uploaded.RootElement.GetProperty("id").GetString();
        Assert.False(string.IsNullOrWhiteSpace(scriptId));

        var putInj = await fx.Host.PutConfigAsync("ScriptInjection", new[]
        {
            new { scriptId, position = "BodyBottom", type = "Classic" },
        });
        putInj.EnsureSuccessStatusCode();

        try
        {
            var since = DateTimeOffset.UtcNow.AddSeconds(-2);
            var actId = Guid.NewGuid().ToString("N");
            await using var act = new MotorActClient(fx.Host);
            await act.ConnectAsync();
            await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/inject-probe", actId);
            await fx.Diagnostics.WaitForEventsAsync(
                act.ConnectionId, "Motor.Session", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

            await fx.Diagnostics.WaitEvaluateContainsAsync(
                act.ConnectionId!, "window.__SPECULUM_INJECTED__", "motor-assert-ok");
        }
        finally
        {
            await fx.Host.PutConfigAsync("ScriptInjection", Array.Empty<object>());
            if (!string.IsNullOrEmpty(scriptId))
                await fx.Host.Http.DeleteAsync($"api/admin/scripts/{scriptId}");
        }
    }

    [MotorAssertFact]
    public async Task G3_drain_on_hosting_put()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var drainSince = DateTimeOffset.UtcNow.AddSeconds(-1);
        var put = await fx.Host.PutConfigAsync("Hosting", new
        {
            profiles = new object[]
            {
                new { domain = "speculum.test", subdomainMirroringEnabled = false },
            },
        });
        put.EnsureSuccessStatusCode();

        await fx.Diagnostics.WaitForEventsAsync(
            null, "Motor.Drain", drainSince,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.DrainStarted")
                  && DiagnosticsAssertClient.HasEvent(ev, "Motor.DrainCompleted"));
    }

    [MotorAssertFact]
    public async Task H5_script_url_ssrf_rejected()
    {
        var put = await fx.Host.PutConfigAsync("ScriptInjection", new[]
        {
            new { url = "http://127.0.0.1:9/pwn.js", position = "BodyBottom", type = "Classic" },
        });
        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
    }

    [MotorAssertFact]
    public async Task E4_admin_persisted_list_and_get()
    {
        var token = MotorAssertTokens.Fixed("persist-e4-get");
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

        var listRes = await fx.Host.Http.GetAsync("api/admin/diagnostics/v1/persisted");
        listRes.EnsureSuccessStatusCode();
        using var listDoc = JsonDocument.Parse(await listRes.Content.ReadAsStringAsync());
        Assert.True(listDoc.RootElement.GetArrayLength() >= 1);

        string? sessionId = null;
        foreach (var item in listDoc.RootElement.EnumerateArray())
        {
            if (item.TryGetProperty("clientToken", out var ct)
                && string.Equals(ct.GetString(), token, StringComparison.Ordinal)
                && item.TryGetProperty("sessionId", out var sid)
                && sid.GetString() is { } id)
            {
                sessionId = id;
                break;
            }
        }

        Assert.False(string.IsNullOrWhiteSpace(sessionId), $"no persisted row for token {token}");
        var detail = await fx.Host.Http.GetAsync($"api/admin/diagnostics/v1/persisted/{sessionId}");
        detail.EnsureSuccessStatusCode();
    }

    [MotorAssertFact]
    public async Task F1_session_policy_ttl_accepts_put()
    {
        var put = await fx.Host.PutConfigAsync("SessionPolicy", new { ttlDays = 7 });
        put.EnsureSuccessStatusCode();
        var del = await fx.Host.DeleteConfigAsync("SessionPolicy");
        Assert.True(del.IsSuccessStatusCode, $"DELETE SessionPolicy => {(int)del.StatusCode}");
        var get = await fx.Host.Http.GetAsync("api/admin/config/SessionPolicy");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
        await fx.Host.PutConfigAsync("SessionPolicy", new { ttlDays = 30 });
    }

    [MotorAssertFact]
    public async Task G4_max_sessions_put_does_not_drain()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var put = await fx.Host.PutConfigAsync("MaxSessions", 4);
        put.EnsureSuccessStatusCode();
        // MaxSessions does not emit Diagnostics.ConfigApplied — assert live session survives immediately.

        var still = await fx.Diagnostics.TryGetSessionAsync(act.ConnectionId!);
        Assert.NotNull(still);
        Assert.Equal("Running", still!.Value.GetProperty("snapshot").GetProperty("phase").GetString());
    }

    [MotorAssertFact]
    public async Task H1_script_upload_lists_id()
    {
        var scriptBody = "window.__noop = 1;";
        using var content = new MultipartFormDataContent();
        content.Add(new ByteArrayContent(Encoding.UTF8.GetBytes(scriptBody)), "file", "noop.js");
        var upload = await fx.Host.Http.PostAsync("api/admin/scripts", content);
        upload.EnsureSuccessStatusCode();
        using var uploaded = JsonDocument.Parse(await upload.Content.ReadAsStringAsync());
        var scriptId = uploaded.RootElement.GetProperty("id").GetString();
        Assert.False(string.IsNullOrWhiteSpace(scriptId));
        await fx.Host.Http.DeleteAsync($"api/admin/scripts/{scriptId}");
    }
}
