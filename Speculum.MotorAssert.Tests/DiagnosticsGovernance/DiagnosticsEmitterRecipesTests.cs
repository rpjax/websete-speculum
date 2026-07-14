using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

[Collection(nameof(MotorAssertCollection))]
[Trait("Category", "MotorAssertive")]
public sealed class DiagnosticsEmitterRecipesTests(MotorAssertFixture fx)
{
    [MotorAssertFact]
    public async Task D_Start_emits_SessionResolved_with_required_payload()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/home", actId);

        var events = await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionResolved", actId)
                  && DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var resolved = events.First(e =>
            e.GetProperty("name").GetString() == "Motor.SessionResolved"
            && e.GetProperty("correlationId").GetString() == actId);

        Assert.True(resolved.TryGetProperty("payload", out var payload), resolved.ToString());
        foreach (var name in new[]
                 {
                     "clientTokenProvided", "clientTokenEffective", "persistedSessionId",
                     "restored", "stateLoaded", "cookieCount", "localStorageCount",
                     "historyCount", "initialUrl",
                 })
        {
            Assert.True(payload.TryGetProperty(name, out _), $"SessionResolved payload missing {name}: {payload}");
        }

        Assert.False(payload.GetProperty("clientTokenProvided").GetBoolean());
        Assert.False(payload.GetProperty("restored").GetBoolean());
        Assert.False(string.IsNullOrWhiteSpace(payload.GetProperty("clientTokenEffective").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(payload.GetProperty("initialUrl").GetString()));
    }

    [MotorAssertFact]
    public async Task D_Create_without_token_marks_not_restored()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/", actId);

        var events = await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.SessionResolved", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionResolved", actId));

        var payload = events.First(e => e.GetProperty("name").GetString() == "Motor.SessionResolved")
            .GetProperty("payload");
        Assert.False(payload.GetProperty("clientTokenProvided").GetBoolean());
        Assert.False(payload.GetProperty("restored").GetBoolean());
    }

    [MotorAssertFact]
    public async Task D_Restore_marks_restored_true_after_export()
    {
        var token = MotorAssertTokens.Fixed("diag-d-restore");
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
            await act.DisconnectAsync();
        }

        await fx.Diagnostics.WaitForEventsAsync(
            null, "Motor.StateExport", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.StateExportCompleted"));

        var since2 = DateTimeOffset.UtcNow.AddSeconds(-1);
        var actId2 = Guid.NewGuid().ToString("N");
        await using var act2 = new MotorActClient(fx.Host);
        await act2.ConnectAsync();
        await act2.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/nav/a", actId2, clientToken: token);

        var events = await fx.Diagnostics.WaitForEventsAsync(
            act2.ConnectionId, "Motor.SessionResolved", since2,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionResolved", actId2));

        var payload = events.First(e =>
                e.GetProperty("name").GetString() == "Motor.SessionResolved"
                && e.GetProperty("correlationId").GetString() == actId2)
            .GetProperty("payload");

        Assert.True(payload.GetProperty("clientTokenProvided").GetBoolean());
        Assert.True(payload.GetProperty("restored").GetBoolean());
        Assert.True(payload.GetProperty("stateLoaded").GetBoolean());
        Assert.True(payload.GetProperty("cookieCount").GetInt32() > 0
                    || payload.GetProperty("localStorageCount").GetInt32() > 0);
    }

    [MotorAssertFact]
    public async Task D_UrlMap_emits_clientUrl_with_path_and_nso_on_nav()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/nav/a", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await act.NavigateAsync($"{fx.Host.FixtureClientOrigin}/nav/b");

        var events = await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.UrlMapped", since,
            ev => ev.Any(e =>
            {
                if (e.GetProperty("name").GetString() != "Motor.UrlMapped")
                    return false;
                if (!e.TryGetProperty("payload", out var p))
                    return false;
                var client = p.TryGetProperty("clientUrl", out var cu) ? cu.GetString() : null;
                return client is not null
                       && client.Contains("/nav/b", StringComparison.Ordinal)
                       && client.Contains("_w7s_nso", StringComparison.Ordinal);
            }),
            timeout: TimeSpan.FromSeconds(60));

        Assert.Contains(events, e => e.GetProperty("name").GetString() == "Motor.UrlMapped");

        var status = await act.WaitForStatusAsync(
            s => s.Url.Contains("/nav/b", StringComparison.Ordinal)
                 && s.Url.Contains("_w7s_nso", StringComparison.Ordinal),
            TimeSpan.FromSeconds(30));
        Assert.Contains("/nav/b", status.Url, StringComparison.Ordinal);
    }
}
