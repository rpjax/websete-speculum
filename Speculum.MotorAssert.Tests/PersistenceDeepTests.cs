using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

[Collection(nameof(MotorAssertCollection))]
[Trait("Category", "MotorAssertive")]
public sealed class PersistenceDeepTests : MotorAssertTestBase
{
    public PersistenceDeepTests(MotorAssertFixture fixture) : base(fixture) { }

    [MotorAssertFact]
    public async Task E3_persisted_detail_includes_history()
    {
        var token = MotorAssertTokens.Fixed("persist-e3-hist");
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");

        await using (var act = new MotorActClient(fx.Host))
        {
            await act.ConnectAsync();
            await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/nav/a", actId, clientToken: token);
            await fx.Diagnostics.WaitForEventsAsync(
                act.ConnectionId, "Motor.Session", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));
            await act.NavigateAsync($"{fx.Host.FixtureClientOrigin}/nav/b");
            await fx.Diagnostics.WaitEvaluateContainsAsync(
                act.ConnectionId!, "location.pathname", "/nav/b");
            var exportSince = DateTimeOffset.UtcNow.AddSeconds(-1);
            var connId = act.ConnectionId!;
            await act.DisconnectAsync();
            await fx.Diagnostics.WaitStateExportCompletedAsync(connId, exportSince);
        }

        var sessionId = await FindPersistedSessionIdAsync(token);
        var detailRes = await fx.Host.Http.GetAsync($"api/admin/diagnostics/v1/persisted/{sessionId}");
        detailRes.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await detailRes.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.TryGetProperty("detail", out var detail), doc.RootElement.ToString());
        Assert.True(detail.TryGetProperty("history", out var history), detail.ToString());
        Assert.True(history.GetArrayLength() >= 2, $"expected >=2 history rows after nav a→b, got {history}");
        var histText = history.ToString();
        Assert.Contains("/nav/a", histText, StringComparison.Ordinal);
        Assert.Contains("/nav/b", histText, StringComparison.Ordinal);
    }

    [MotorAssertFact]
    public async Task E3b_reattach_merges_history_across_generations()
    {
        var token = MotorAssertTokens.Fixed("persist-e3b-merge");
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");

        await using (var act = new MotorActClient(fx.Host))
        {
            await act.ConnectAsync();
            await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/nav/a", actId, clientToken: token);
            await fx.Diagnostics.WaitForEventsAsync(
                act.ConnectionId, "Motor.Session", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));
            await act.NavigateAsync($"{fx.Host.FixtureClientOrigin}/nav/b");
            await fx.Diagnostics.WaitEvaluateContainsAsync(
                act.ConnectionId!, "location.pathname", "/nav/b");
            var exportSince = DateTimeOffset.UtcNow.AddSeconds(-1);
            var connId = act.ConnectionId!;
            await act.DisconnectAsync();
            await fx.Diagnostics.WaitStateExportCompletedAsync(connId, exportSince);
        }

        var sessionId = await FindPersistedSessionIdAsync(token);
        var gen1Count = await ReadHistoryCountAsync(sessionId);
        Assert.True(gen1Count >= 2, $"expected >=2 history rows after gen1, got {gen1Count}");

        var since2 = DateTimeOffset.UtcNow.AddSeconds(-1);
        var actId2 = Guid.NewGuid().ToString("N");
        await using (var act2 = new MotorActClient(fx.Host))
        {
            await act2.ConnectAsync();
            await act2.StartSessionAsync(
                $"{fx.Host.FixtureClientOrigin}/set-state", actId2, clientToken: token);
            await fx.Diagnostics.WaitForEventsAsync(
                act2.ConnectionId, "Motor.Session", since2,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId2));
            await fx.Diagnostics.WaitEvaluateContainsAsync(
                act2.ConnectionId!, "location.pathname", "/set-state");
            var exportSince2 = DateTimeOffset.UtcNow.AddSeconds(-1);
            var connId2 = act2.ConnectionId!;
            await act2.DisconnectAsync();
            await fx.Diagnostics.WaitStateExportCompletedAsync(connId2, exportSince2);
        }

        var sessionId2 = await FindPersistedSessionIdAsync(token);
        Assert.Equal(sessionId, sessionId2);

        var detailRes = await fx.Host.Http.GetAsync($"api/admin/diagnostics/v1/persisted/{sessionId}");
        detailRes.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await detailRes.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.TryGetProperty("detail", out var detail), doc.RootElement.ToString());
        Assert.True(detail.TryGetProperty("history", out var history), detail.ToString());
        Assert.True(
            history.GetArrayLength() > gen1Count,
            $"expected history to grow across reattach (gen1={gen1Count}, after={history.GetArrayLength()}): {history}");
        var histText = history.ToString();
        Assert.Contains("/nav/a", histText, StringComparison.Ordinal);
        Assert.Contains("/nav/b", histText, StringComparison.Ordinal);
        Assert.Contains("/set-state", histText, StringComparison.Ordinal);
    }

    [MotorAssertFact]
    public async Task E5_indexers_resolve_same_persisted_session()
    {
        var token = MotorAssertTokens.Fixed("persist-e5-idx");
        var indexers = new Dictionary<string, string> { ["tenant"] = "motor-assert-e5" };
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");

        await using (var act = new MotorActClient(fx.Host))
        {
            await act.ConnectAsync();
            await act.StartSessionAsync(
                $"{fx.Host.FixtureClientOrigin}/set-state", actId,
                clientToken: token, indexers: indexers);
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

        var sessionId1 = await FindPersistedSessionIdAsync(token);

        var since2 = DateTimeOffset.UtcNow.AddSeconds(-1);
        var actId2 = Guid.NewGuid().ToString("N");
        await using var act2 = new MotorActClient(fx.Host);
        await act2.ConnectAsync();
        // Resolve via custom indexer alone — MessagePack must preserve Dictionary Indexers.
        await act2.StartSessionAsync(
            $"{fx.Host.FixtureClientOrigin}/nav/a",
            actId2,
            clientToken: null,
            indexers: new Dictionary<string, string>(indexers, StringComparer.Ordinal));
        await fx.Diagnostics.WaitForEventsAsync(
            act2.ConnectionId, "Motor.Session", since2,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId2));

        await fx.Diagnostics.ExpectCookieAsync(act2.ConnectionId!, "sf_marker", "state-cookie");
        await fx.Diagnostics.ExpectLocalStorageAsync(act2.ConnectionId!, "sf_ls", "state-ls");

        // Same logical session should still be listable under original token metadata path;
        // at least restore truth proves indexer routed to the exported state.
        Assert.False(string.IsNullOrWhiteSpace(sessionId1));
        var sessionId2 = await FindPersistedSessionIdAsync(token);
        Assert.Equal(sessionId1, sessionId2);
    }

    [MotorAssertFact]
    public async Task E6_state_export_failed_on_sidecar_kill()
    {
        var composeFile = Path.GetFullPath(Path.Combine(
            Directory.GetCurrentDirectory(), "deploy", "compose", "docker-compose.motor-assert.yml"));
        if (!File.Exists(composeFile))
        {
            composeFile = Path.GetFullPath(Path.Combine(
                AppContext.BaseDirectory, "..", "..", "..", "..",
                "deploy", "compose", "docker-compose.motor-assert.yml"));
        }

        Assert.True(File.Exists(composeFile), "compose file required for E6");

        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/set-state", actId,
            clientToken: MotorAssertTokens.Fixed("persist-e6-fail"));
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        try
        {
            RunCompose(composeFile, "stop", "sidecar");
            var faultEvents = await fx.Diagnostics.WaitForEventsAsync(
                act.ConnectionId, "Motor.", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SidecarFaulted"),
                timeout: TimeSpan.FromSeconds(90));
            var faulted = faultEvents.First(e =>
                string.Equals(e.GetProperty("name").GetString(), "Motor.SidecarFaulted", StringComparison.Ordinal));
            var faultPayload = DiagnosticsAssertClient.RequireProperty(faulted, "payload");
            Assert.False(string.IsNullOrWhiteSpace(
                DiagnosticsAssertClient.RequireProperty(faultPayload, "errorCode").GetString()));
            Assert.False(string.IsNullOrWhiteSpace(
                DiagnosticsAssertClient.RequireProperty(faultPayload, "fault").GetString()));

            await act.DisconnectAsync();
            var exportEvents = await fx.Diagnostics.WaitForEventsAsync(
                null, "Motor.StateExport", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.StateExportFailed"),
                timeout: TimeSpan.FromSeconds(60));
            var exportFailed = exportEvents.First(e =>
                string.Equals(e.GetProperty("name").GetString(), "Motor.StateExportFailed", StringComparison.Ordinal));
            var exportPayload = DiagnosticsAssertClient.RequireProperty(exportFailed, "payload");
            Assert.False(string.IsNullOrWhiteSpace(
                DiagnosticsAssertClient.RequireProperty(exportPayload, "errorCode").GetString()));
            Assert.Equal("export",
                DiagnosticsAssertClient.RequireProperty(exportPayload, "phase").GetString());
        }
        finally
        {
            RunCompose(composeFile, "start", "sidecar");
            await MotorAssertCompose.WaitSidecarHttpHealthyAsync(composeFile);
            await fx.Host.EnsureReadyAsync();
        }
    }

    [MotorAssertFact]
    public async Task E7_drain_preserves_persisted_state()
    {
        var token = MotorAssertTokens.Fixed("persist-e7-drain");
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
            await fx.Diagnostics.WaitLocalStorageAsync(act.ConnectionId!, "sf_ls", "state-ls");
            var exportSince = DateTimeOffset.UtcNow.AddSeconds(-1);
            var connId = act.ConnectionId!;
            await act.DisconnectAsync();
            await fx.Diagnostics.WaitStateExportCompletedAsync(connId, exportSince);
        }

        var sessionId = await FindPersistedSessionIdAsync(token);
        await WaitPersistedCookiesContainAsync(sessionId, "sf_marker");

        var drainSince = DateTimeOffset.UtcNow.AddSeconds(-1);
        var put = await fx.Host.PutConfigAsync("Forwarding", new
        {
            host = "fixture.test",
            domains = new[] { "fixture.test", "*.fixture.test" },
        });
        put.EnsureSuccessStatusCode();
        await fx.Diagnostics.WaitForEventsAsync(
            null, "Motor.Drain", drainSince,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.DrainCompleted"));

        await WaitPersistedCookiesContainAsync(sessionId, "sf_marker");
        var detail = await fx.Host.Http.GetAsync($"api/admin/diagnostics/v1/persisted/{sessionId}");
        detail.EnsureSuccessStatusCode();
        using var detailDoc = JsonDocument.Parse(await detail.Content.ReadAsStringAsync());
        Assert.True(detailDoc.RootElement.TryGetProperty("detail", out var detailEl), detailDoc.RootElement.ToString());
        Assert.True(detailEl.TryGetProperty("cookies", out var cookies), detailEl.ToString());
        Assert.Contains("sf_marker", cookies.ToString(), StringComparison.Ordinal);
        Assert.True(detailEl.TryGetProperty("localStorage", out var ls), detailEl.ToString());
        Assert.Contains("sf_ls", ls.ToString(), StringComparison.Ordinal);
    }

    private async Task WaitPersistedCookiesContainAsync(string sessionId, string marker)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(30);
        string? last = null;
        while (DateTime.UtcNow < deadline)
        {
            var detail = await fx.Host.Http.GetAsync($"api/admin/diagnostics/v1/persisted/{sessionId}");
            if (detail.IsSuccessStatusCode)
            {
                var text = await detail.Content.ReadAsStringAsync();
                last = text;
                using var doc = JsonDocument.Parse(text);
                if (doc.RootElement.TryGetProperty("detail", out var d)
                    && d.TryGetProperty("cookies", out var cookies)
                    && cookies.ToString().Contains(marker, StringComparison.Ordinal))
                    return;
            }

            await Task.Delay(250);
        }

        Assert.Fail($"persisted session {sessionId} never showed cookie '{marker}'. last={last}");
    }

    [MotorAssertFact]
    public async Task F2_session_policy_ttl_put_reflected()
    {
        var put = await fx.Host.PutConfigAsync("SessionPolicy", new { ttlDays = 3 });
        put.EnsureSuccessStatusCode();
        try
        {
            var get = await fx.Host.Http.GetAsync("api/admin/config/SessionPolicy");
            get.EnsureSuccessStatusCode();
            var text = await get.Content.ReadAsStringAsync();
            Assert.Contains("3", text, StringComparison.Ordinal);
        }
        finally
        {
            await fx.Host.PutConfigAsync("SessionPolicy", new { ttlDays = 30 });
        }
    }

    [MotorAssertFact]
    public async Task F3_delete_session_policy_clears_section()
    {
        await fx.Host.PutConfigAsync("SessionPolicy", new { ttlDays = 9 });
        var del = await fx.Host.DeleteConfigAsync("SessionPolicy");
        Assert.True(del.IsSuccessStatusCode, $"DELETE SessionPolicy failed: {(int)del.StatusCode}");
        var get = await fx.Host.Http.GetAsync("api/admin/config/SessionPolicy");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
        await fx.Host.PutConfigAsync("SessionPolicy", new { ttlDays = 30 });
    }

    private async Task<string> FindPersistedSessionIdAsync(string token)
    {
        var listRes = await fx.Host.Http.GetAsync("api/admin/diagnostics/v1/persisted");
        listRes.EnsureSuccessStatusCode();
        using var listDoc = JsonDocument.Parse(await listRes.Content.ReadAsStringAsync());
        foreach (var item in listDoc.RootElement.EnumerateArray())
        {
            if (item.TryGetProperty("clientToken", out var ct)
                && string.Equals(ct.GetString(), token, StringComparison.Ordinal)
                && item.TryGetProperty("sessionId", out var sid)
                && sid.GetString() is { } sessionId)
            {
                return sessionId;
            }
        }

        throw new InvalidOperationException($"No persisted session for token {token}");
    }

    private async Task<int> ReadHistoryCountAsync(string sessionId)
    {
        var detailRes = await fx.Host.Http.GetAsync($"api/admin/diagnostics/v1/persisted/{sessionId}");
        detailRes.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await detailRes.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.TryGetProperty("detail", out var detail), doc.RootElement.ToString());
        Assert.True(detail.TryGetProperty("history", out var history), detail.ToString());
        return history.GetArrayLength();
    }

    private static void RunCompose(string composeFile, params string[] args)
    {
        var psi = new System.Diagnostics.ProcessStartInfo
        {
            FileName = "docker",
            ArgumentList = { "compose", "-f", composeFile },
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var a in args)
            psi.ArgumentList.Add(a);
        using var p = System.Diagnostics.Process.Start(psi)!;
        var stdout = p.StandardOutput.ReadToEnd();
        var stderr = p.StandardError.ReadToEnd();
        p.WaitForExit(120_000);
        Assert.True(p.ExitCode == 0, $"docker compose failed: {stdout}\n{stderr}");
    }
}
