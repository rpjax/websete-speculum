using System.Net.Http.Json;
using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

/// <summary>
/// E8 — same clientToken must rebind one persisted row (C# Act path; MsgPack trap is separate).
/// Known-red notes: see MATRIX / docs/diagnostics.md Known red.
/// </summary>
[Collection(nameof(MotorAssertCollection))]
[Trait("Category", "MotorAssertive")]
public sealed class SessionRebindTrapTests(MotorAssertFixture fx)
{
    [MotorAssertFact]
    public async Task E8_rebind_same_token_must_not_create_second_persisted_row()
    {
        var token = MotorAssertTokens.Fixed("trap-e8-rebind");
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");

        await using (var act = new MotorActClient(fx.Host))
        {
            await act.ConnectAsync();
            await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/set-state", actId, clientToken: token);
            await fx.Diagnostics.WaitForEventsAsync(
                act.ConnectionId, "Motor.Session", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId)
                      && DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionResolved", actId));
            await fx.Diagnostics.ExpectCookieAsync(act.ConnectionId!, "sf_marker", "state-cookie");
            await act.DisconnectAsync();
        }

        await fx.Diagnostics.WaitForEventsAsync(
            null, "Motor.StateExport", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.StateExportCompleted"));

        var sessionId1 = await FindPersistedByTokenAsync(token);

        var since2 = DateTimeOffset.UtcNow.AddSeconds(-1);
        var actId2 = Guid.NewGuid().ToString("N");
        await using var act2 = new MotorActClient(fx.Host);
        await act2.ConnectAsync();
        var returned = await act2.StartSessionAsync(
            $"{fx.Host.FixtureClientOrigin}/nav/a", actId2, clientToken: token);
        Assert.Equal(token, returned);

        var events = await fx.Diagnostics.WaitForEventsAsync(
            act2.ConnectionId, "Motor.SessionResolved", since2,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionResolved", actId2));
        var payload = events.First(e =>
                e.GetProperty("name").GetString() == "Motor.SessionResolved"
                && e.GetProperty("correlationId").GetString() == actId2)
            .GetProperty("payload");
        Assert.True(payload.GetProperty("restored").GetBoolean(), payload.ToString());
        Assert.Equal(sessionId1, payload.GetProperty("persistedSessionId").GetString());

        await fx.Diagnostics.ExpectCookieAsync(act2.ConnectionId!, "sf_marker", "state-cookie");
        await fx.Diagnostics.ExpectLocalStorageAsync(act2.ConnectionId!, "sf_ls", "state-ls");

        var matches = await CountPersistedRowsForTokenAsync(token);
        Assert.Equal(1, matches);
    }

    private async Task<string> FindPersistedByTokenAsync(string token)
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

    private async Task<int> CountPersistedRowsForTokenAsync(string token)
    {
        var list = await fx.Host.Http.GetFromJsonAsync<JsonElement>("api/admin/diagnostics/v1/persisted");
        var n = 0;
        foreach (var item in list.EnumerateArray())
        {
            if (item.TryGetProperty("clientToken", out var ct)
                && string.Equals(ct.GetString(), token, StringComparison.Ordinal))
                n++;
        }

        return n;
    }
}
