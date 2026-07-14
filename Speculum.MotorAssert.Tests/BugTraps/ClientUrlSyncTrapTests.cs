namespace Speculum.MotorAssert.Tests;

/// <summary>B12 — client-mapped URL (path + NSO) must appear on status / UrlMapped after nav.</summary>
[Collection(nameof(MotorAssertCollection))]
[Trait("Category", "MotorAssertive")]
public sealed class ClientUrlSyncTrapTests(MotorAssertFixture fx)
{
    [MotorAssertFact]
    public async Task B12_status_and_UrlMapped_use_motor_client_url_with_nso()
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

        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.UrlMapped", since,
            ev => ev.Any(e =>
            {
                if (e.GetProperty("name").GetString() != "Motor.UrlMapped")
                    return false;
                if (!e.TryGetProperty("payload", out var p))
                    return false;
                var client = p.TryGetProperty("clientUrl", out var cu) ? cu.GetString() ?? "" : "";
                var target = p.TryGetProperty("targetUrl", out var tu) ? tu.GetString() ?? "" : "";
                return client.Contains("/nav/b", StringComparison.Ordinal)
                       && client.Contains("_w7s_nso", StringComparison.Ordinal)
                       && target.Contains("/nav/b", StringComparison.Ordinal);
            }),
            timeout: TimeSpan.FromSeconds(60));

        var status = await act.WaitForStatusAsync(
            s => !string.IsNullOrWhiteSpace(s.Url)
                 && s.Url.Contains("/nav/b", StringComparison.Ordinal)
                 && s.Url.Contains("_w7s_nso", StringComparison.Ordinal),
            TimeSpan.FromSeconds(45));

        Assert.DoesNotContain("fixture.test", status.Url, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("_w7s_nso", status.Url, StringComparison.Ordinal);
    }
}
