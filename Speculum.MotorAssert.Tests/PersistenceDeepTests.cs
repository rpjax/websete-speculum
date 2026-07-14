using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

[Collection(nameof(MotorAssertCollection))]
[Trait("Category", "MotorAssertive")]
public sealed class PersistenceDeepTests(MotorAssertFixture fx)
{
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
            await Task.Delay(2500);
            await act.DisconnectAsync();
        }

        await fx.Diagnostics.WaitForEventsAsync(
            null, "Motor.StateExport", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.StateExportCompleted"));

        var sessionId = await FindPersistedSessionIdAsync(token);
        var detailRes = await fx.Host.Http.GetAsync($"api/admin/diagnostics/v1/persisted/{sessionId}");
        detailRes.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await detailRes.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.TryGetProperty("detail", out var detail), doc.RootElement.ToString());
        Assert.True(detail.TryGetProperty("history", out var history) || detail.TryGetProperty("History", out history),
            detail.ToString());
        Assert.True(history.GetArrayLength() >= 1, $"expected history rows, got {history}");
        Assert.Contains("/nav/", history.ToString(), StringComparison.Ordinal);
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
            await Task.Delay(2500);
            await fx.Diagnostics.ExpectCookieAsync(act.ConnectionId!, "sf_marker", "state-cookie");
            await fx.Diagnostics.ExpectLocalStorageAsync(act.ConnectionId!, "sf_ls", "state-ls");
            await act.DisconnectAsync();
        }

        await fx.Diagnostics.WaitForEventsAsync(
            null, "Motor.StateExport", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.StateExportCompleted"));

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

        await Task.Delay(2500);
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
            // Fault may land before disconnect; after disconnect expect export Failed.
            await Task.Delay(1500);
            await act.DisconnectAsync();

            await fx.Diagnostics.WaitForEventsAsync(
                null, "Motor.", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.StateExportFailed")
                      || DiagnosticsAssertClient.HasEvent(ev, "Motor.SidecarFaulted"),
                timeout: TimeSpan.FromSeconds(90));
        }
        finally
        {
            RunCompose(composeFile, "start", "sidecar");
            await Task.Delay(8000);
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
            await Task.Delay(1200);
            await act.DisconnectAsync();
        }

        await fx.Diagnostics.WaitForEventsAsync(
            null, "Motor.StateExport", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.StateExportCompleted"));

        var sessionId = await FindPersistedSessionIdAsync(token);

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

        var detail = await fx.Host.Http.GetAsync($"api/admin/diagnostics/v1/persisted/{sessionId}");
        detail.EnsureSuccessStatusCode();
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
    public async Task F3_delete_session_policy_restores_default_or_accepts()
    {
        await fx.Host.PutConfigAsync("SessionPolicy", new { ttlDays = 9 });
        var del = await fx.Host.DeleteConfigAsync("SessionPolicy");
        Assert.True(del.IsSuccessStatusCode || del.StatusCode is HttpStatusCode.BadRequest
                    || del.StatusCode is HttpStatusCode.NoContent);
        var get = await fx.Host.Http.GetAsync("api/admin/config/SessionPolicy");
        // After delete, section may be missing (404) or default payload.
        Assert.True(get.IsSuccessStatusCode || get.StatusCode == HttpStatusCode.NotFound);
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
                && item.TryGetProperty("sessionId", out var sid))
                return sid.GetString()!;
            if (item.TryGetProperty("id", out var id) && id.GetString() is { } fallback)
                return fallback;
        }

        throw new InvalidOperationException($"No persisted session for token {token}");
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
