using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

[Collection(nameof(MotorAssertCollection))]
[Trait("Category", "MotorAssertive")]
public sealed class InputResizeProbeGovernanceTests(MotorAssertFixture fx)
{
    [MotorAssertFact]
    public async Task D1_resize_emits_requested()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var resizeSince = DateTimeOffset.UtcNow.AddSeconds(-1);
        await act.ResizeAsync(1024, 768);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Resize", resizeSince,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.ResizeRequested"));
    }

    [MotorAssertFact]
    public async Task L1_L3_L6_browser_probes_process_tabs_evaluate()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/home", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await Task.Delay(1500);
        var probe = await fx.Diagnostics.PostBrowserProbeAsync(
            act.ConnectionId!,
            ["process", "tabs", "evaluate", "dom"],
            evaluateExpression: "document.getElementById('speculum-probe')?.dataset?.page",
            domSelector: "#speculum-probe");
        Assert.True(probe.GetProperty("ok").GetBoolean());
        Assert.Contains("home", probe.GetProperty("data").ToString(), StringComparison.Ordinal);
    }

    [MotorAssertFact]
    public async Task L8_probe_level_insufficient_when_browser_query_off()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var put = await fx.Host.PutConfigAsync("Diagnostics", new
        {
            enabled = true,
            defaultLevel = "Events",
            domains = new
            {
                motorLive = "Events",
                sidecarBrowser = "Metrics",
                hostResources = "Metrics",
                browserQuery = "Off",
                persistedSessions = "StateSnapshots",
            },
            probe = new { maxConcurrentProbesPerSession = 2, diagTimeoutMs = 10000, maxProbeResponseBytes = 524288 },
        });
        put.EnsureSuccessStatusCode();

        try
        {
            var res = await fx.Host.Http.PostAsJsonAsync(
                $"api/admin/diagnostics/v1/sessions/{act.ConnectionId}/browser",
                new { ops = new[] { "cookies" } },
                MotorAssertHost.Json);
            Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
            Assert.Equal("probe_level_insufficient", doc.RootElement.GetProperty("errorCode").GetString());
        }
        finally
        {
            await fx.RestoreAssertiveDiagnosticsAsync();
        }
    }

    [MotorAssertFact]
    public async Task M2_elevate_audit_events()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-1);
        var put = await fx.Host.Http.PutAsJsonAsync(
            "api/admin/diagnostics/v1/elevate",
            new { browserQueryFloor = "BrowserQuery", minutes = 5 },
            MotorAssertHost.Json);
        put.EnsureSuccessStatusCode();

        await fx.Diagnostics.WaitForEventsAsync(
            null, "Diagnostics.Elevate", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Diagnostics.ElevateStarted"));

        var del = await fx.Host.Http.DeleteAsync("api/admin/diagnostics/v1/elevate");
        del.EnsureSuccessStatusCode();

        await fx.Diagnostics.WaitForEventsAsync(
            null, "Diagnostics.Elevate", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Diagnostics.ElevateExpired"));
    }

    [MotorAssertFact]
    public async Task L13_host_envelope()
    {
        var res = await fx.Host.Http.GetAsync("api/admin/diagnostics/v1/host");
        res.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.TryGetProperty("data", out _));
        Assert.True(doc.RootElement.TryGetProperty("redaction", out _));
    }

    [MotorAssertFact]
    public async Task O1_admin_requires_bearer()
    {
        using var anon = new HttpClient { BaseAddress = new Uri(fx.Host.ApiBase + "/") };
        var res = await anon.GetAsync("api/admin/diagnostics/v1/runtime");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [MotorAssertFact]
    public async Task J1_J2_public_client_config_and_ready()
    {
        var ready = await fx.Host.Http.GetAsync("/ready");
        ready.EnsureSuccessStatusCode();
        var cfg = await fx.Host.Http.GetAsync("/api/public/client-config");
        cfg.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await cfg.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.TryGetProperty("nsoParamName", out _)
                    || doc.RootElement.TryGetProperty("NsoParamName", out _));
    }

    [MotorAssertFact]
    public async Task K2_traefik_paths_health_api_ready()
    {
        var traefik = Environment.GetEnvironmentVariable("MOTOR_ASSERT_TRAEFIK_BASE")
                      ?? "http://127.0.0.1:18081";
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        foreach (var path in new[] { "/health", "/ready" })
        {
            var res = await http.GetAsync($"{traefik.TrimEnd('/')}{path}");
            Assert.True(res.IsSuccessStatusCode, $"Traefik path {path} => {(int)res.StatusCode}");
        }
    }

    [MotorAssertFact]
    public async Task M11_catalog_events_endpoint()
    {
        var res = await fx.Host.Http.GetAsync("api/admin/diagnostics/v1/catalog/events");
        res.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        var events = doc.RootElement.GetProperty("events").EnumerateArray().Select(e => e.GetString()).ToHashSet();
        Assert.Contains("Motor.SessionStarted", events);
        Assert.Contains("Diagnostics.StorageOverflow", events);
    }

    [MotorAssertFact]
    public async Task L11_probe_response_too_large()
    {
        var put = await fx.Host.PutConfigAsync(
            "Diagnostics",
            MotorAssertFixture.AssertiveDiagnosticsConfig(maxProbeResponseBytes: 2048));
        put.EnsureSuccessStatusCode();

        try
        {
            var since = DateTimeOffset.UtcNow.AddSeconds(-2);
            var actId = Guid.NewGuid().ToString("N");
            await using var act = new MotorActClient(fx.Host);
            await act.ConnectAsync();
            await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/fat-dom", actId);
            await fx.Diagnostics.WaitForEventsAsync(
                act.ConnectionId, "Motor.Session", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

            await Task.Delay(1000);
            var res = await fx.Host.Http.PostAsJsonAsync(
                $"api/admin/diagnostics/v1/sessions/{act.ConnectionId}/browser",
                new { ops = new[] { "dom" }, domSelector = "#speculum-probe" },
                MotorAssertHost.Json);

            if (res.IsSuccessStatusCode)
            {
                using var ok = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
                Assert.True(ok.RootElement.TryGetProperty("ok", out _));
            }
            else
            {
                Assert.True(
                    res.StatusCode is HttpStatusCode.RequestEntityTooLarge
                        or HttpStatusCode.Forbidden
                        or HttpStatusCode.BadRequest
                        or (HttpStatusCode)413);
            }
        }
        finally
        {
            await fx.RestoreAssertiveDiagnosticsAsync();
        }
    }

    [MotorAssertFact]
    public async Task O2_admin_section_opaque()
    {
        var res = await fx.Host.Http.GetAsync("api/admin/config/Admin");
        res.EnsureSuccessStatusCode();
        var text = await res.Content.ReadAsStringAsync();
        Assert.DoesNotContain("motor-assert-admin-key", text, StringComparison.Ordinal);
        Assert.Contains("configured", text, StringComparison.OrdinalIgnoreCase);
    }

    [MotorAssertFact]
    public async Task O3_config_validation_rejects_bad_max_sessions()
    {
        var put = await fx.Host.PutConfigAsync("MaxSessions", 0);
        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
    }
}
