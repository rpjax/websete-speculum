using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

[Collection(nameof(MotorAssertCollection))]
[Trait("Category", "MotorAssertive")]
public sealed class DiagnosticsEdgeDeepTests(MotorAssertFixture fx)
{
    [MotorAssertFact]
    public async Task L2_L6_probe_cookies_storage_dom_evaluate_fixture()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/set-state", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        await Task.Delay(1000);
        await fx.Diagnostics.ExpectCookieAsync(act.ConnectionId!, "sf_marker", "state-cookie");
        await fx.Diagnostics.ExpectLocalStorageAsync(act.ConnectionId!, "sf_ls", "state-ls");

        var dom = await fx.Diagnostics.PostBrowserProbeAsync(
            act.ConnectionId!, ["dom"], domSelector: "#speculum-probe");
        Assert.True(dom.GetProperty("ok").GetBoolean(), dom.ToString());
        Assert.Contains("set-state", dom.GetProperty("data").ToString(), StringComparison.Ordinal);

        await fx.Diagnostics.ExpectEvaluateAsync(
            act.ConnectionId!,
            "window.__SPECULUM_FIXTURE__?.page",
            "set-state");

        var storage = await fx.Diagnostics.PostBrowserProbeAsync(act.ConnectionId!, ["storage"]);
        Assert.True(storage.GetProperty("ok").GetBoolean(), storage.ToString());
        Assert.Contains("sf_ls", storage.GetProperty("data").ToString(), StringComparison.Ordinal);
    }

    [MotorAssertFact]
    public async Task L9_probe_busy_returns_429()
    {
        var put = await fx.Host.PutConfigAsync(
            "Diagnostics",
            MotorAssertFixture.AssertiveDiagnosticsConfig());
        // Tighten concurrency via nested replace — re-PUT with maxConcurrent=1
        put = await fx.Host.PutConfigAsync("Diagnostics", new
        {
            enabled = true,
            defaultLevel = "BrowserQuery",
            domains = new
            {
                motorLive = "BrowserQuery",
                sidecarBrowser = "BrowserQuery",
                hostResources = "Metrics",
                browserQuery = "BrowserQuery",
                persistedSessions = "BrowserQuery",
            },
            probe = new
            {
                maxConcurrentProbesPerSession = 1,
                diagTimeoutMs = 15000,
                maxProbeResponseBytes = 524288,
            },
        });
        put.EnsureSuccessStatusCode();

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

            var body = new
            {
                ops = new[] { "evaluate" },
                evaluateExpression = "await new Promise(r => setTimeout(r, 2500)); 'slow'",
                correlationId = Guid.NewGuid().ToString("N"),
            };

            var t1 = fx.Host.Http.PostAsJsonAsync(
                $"api/admin/diagnostics/v1/sessions/{act.ConnectionId}/browser", body, MotorAssertHost.Json);
            await Task.Delay(100);
            var t2 = fx.Host.Http.PostAsJsonAsync(
                $"api/admin/diagnostics/v1/sessions/{act.ConnectionId}/browser", body, MotorAssertHost.Json);

            var results = await Task.WhenAll(t1, t2);
            Assert.Contains(results, r => r.StatusCode == (HttpStatusCode)429);
            var busy = results.First(r => r.StatusCode == (HttpStatusCode)429);
            using var doc = JsonDocument.Parse(await busy.Content.ReadAsStringAsync());
            Assert.Equal("probe_busy", doc.RootElement.GetProperty("errorCode").GetString());
        }
        finally
        {
            await fx.RestoreAssertiveDiagnosticsAsync();
        }
    }

    [MotorAssertFact]
    public async Task L10_probe_timeout_error_code()
    {
        var put = await fx.Host.PutConfigAsync("Diagnostics", new
        {
            enabled = true,
            defaultLevel = "BrowserQuery",
            domains = new
            {
                motorLive = "BrowserQuery",
                sidecarBrowser = "BrowserQuery",
                hostResources = "Metrics",
                browserQuery = "BrowserQuery",
                persistedSessions = "BrowserQuery",
            },
            probe = new
            {
                maxConcurrentProbesPerSession = 2,
                diagTimeoutMs = 500,
                maxProbeResponseBytes = 524288,
            },
        });
        put.EnsureSuccessStatusCode();

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

            var res = await fx.Host.Http.PostAsJsonAsync(
                $"api/admin/diagnostics/v1/sessions/{act.ConnectionId}/browser",
                new
                {
                    ops = new[] { "evaluate" },
                    evaluateExpression = "await new Promise(r => setTimeout(r, 5000)); 'late'",
                    correlationId = Guid.NewGuid().ToString("N"),
                },
                MotorAssertHost.Json);

            Assert.True(
                res.StatusCode is HttpStatusCode.GatewayTimeout or (HttpStatusCode)504,
                $"expected 504, got {(int)res.StatusCode}");
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
            Assert.Equal("probe_timeout", doc.RootElement.GetProperty("errorCode").GetString());
        }
        finally
        {
            await fx.RestoreAssertiveDiagnosticsAsync();
        }
    }

    [MotorAssertFact]
    public async Task L12_resolve_returns_session_snapshot()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/home", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var res = await fx.Host.Http.GetAsync(
            $"api/admin/diagnostics/v1/resolve?connectionId={Uri.EscapeDataString(act.ConnectionId!)}");
        res.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        Assert.True(
            doc.RootElement.TryGetProperty("snapshot", out _)
            || doc.RootElement.TryGetProperty("connectionId", out _),
            doc.RootElement.ToString());
    }

    [MotorAssertFact]
    public async Task M1_assertive_seed_config_applied_events()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-30);
        var put = await fx.RestoreAssertiveDiagnosticsAsync();
        put.EnsureSuccessStatusCode();

        await fx.Diagnostics.WaitForEventsAsync(
            null, "Diagnostics.", since,
            ev => ev.Any(e =>
                e.GetProperty("name").GetString() is { } n
                && (n.Contains("Config", StringComparison.OrdinalIgnoreCase)
                    || n.Contains("Applied", StringComparison.OrdinalIgnoreCase)
                    || n.Contains("Elevate", StringComparison.OrdinalIgnoreCase)
                    || n.StartsWith("Diagnostics.", StringComparison.Ordinal))),
            timeout: TimeSpan.FromSeconds(30));

        var runtime = await fx.Diagnostics.GetRuntimeAsync();
        Assert.True(runtime.GetProperty("enabled").GetBoolean());
    }

    [MotorAssertFact]
    public async Task M_storage_overflow_contract()
    {
        var put = await fx.Host.PutConfigAsync("Diagnostics", new
        {
            enabled = true,
            defaultLevel = "BrowserQuery",
            domains = new
            {
                motorLive = "BrowserQuery",
                sidecarBrowser = "BrowserQuery",
                hostResources = "Metrics",
                browserQuery = "BrowserQuery",
                persistedSessions = "BrowserQuery",
            },
            probe = new
            {
                maxConcurrentProbesPerSession = 2,
                diagTimeoutMs = 10000,
                maxProbeResponseBytes = 524288,
            },
            storage = new
            {
                maxBytes = 4096,
                ttlHours = 24,
                overflow = "DropOldest",
            },
        });
        put.EnsureSuccessStatusCode();

        try
        {
            var since = DateTimeOffset.UtcNow.AddSeconds(-2);
            // Generate timeline traffic via short-lived sessions.
            for (var i = 0; i < 8; i++)
            {
                await using var act = new MotorActClient(fx.Host);
                await act.ConnectAsync();
                await act.StartSessionAsync(
                    $"{fx.Host.FixtureClientOrigin}/home",
                    Guid.NewGuid().ToString("N"));
                await Task.Delay(200);
                await act.DisconnectAsync();
            }

            await fx.Diagnostics.WaitForEventsAsync(
                null, "Diagnostics.Storage", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Diagnostics.StorageOverflow"),
                timeout: TimeSpan.FromSeconds(60));

            var runtime = await fx.Diagnostics.GetRuntimeAsync();
            Assert.True(runtime.GetProperty("overflowCount").GetInt64() >= 1);
        }
        finally
        {
            await fx.RestoreAssertiveDiagnosticsAsync();
        }
    }

    [MotorAssertFact]
    public async Task M_redaction_development_none()
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
        Assert.True(session.TryGetProperty("redaction", out var redaction), session.ToString());
        var mode = redaction.ValueKind == JsonValueKind.String
            ? redaction.GetString()
            : redaction.TryGetProperty("mode", out var m) ? m.GetString() : redaction.ToString();
        Assert.Contains("none", mode ?? "", StringComparison.OrdinalIgnoreCase);
    }

    [MotorAssertFact]
    public async Task M_timeline_since_and_filters()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/home", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var events = await fx.Diagnostics.QueryEventsAsync(
            act.ConnectionId, "Motor.Session", since);
        Assert.Contains(events, e => e.GetProperty("name").GetString() == "Motor.SessionStarted");
    }

    [MotorAssertFact]
    public async Task K1_hosting_put_writes_bootstrap_yml()
    {
        var composeFile = ResolveComposeFile();
        Assert.NotNull(composeFile);

        var put = await fx.RestoreHostingApexAsync();
        put.EnsureSuccessStatusCode();
        await Task.Delay(1500);

        var psi = new System.Diagnostics.ProcessStartInfo
        {
            FileName = "docker",
            ArgumentList =
            {
                "compose", "-f", composeFile!, "exec", "-T", "api",
                "ls", "/data/traefik/dynamic",
            },
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        using var p = System.Diagnostics.Process.Start(psi)!;
        var stdout = await p.StandardOutput.ReadToEndAsync();
        var stderr = await p.StandardError.ReadToEndAsync();
        await p.WaitForExitAsync();
        Assert.True(p.ExitCode == 0, stderr);
        Assert.Contains("bootstrap.yml", stdout, StringComparison.OrdinalIgnoreCase);
    }

    [MotorAssertFact]
    public async Task K3_cors_preflight_via_traefik()
    {
        var traefik = Environment.GetEnvironmentVariable("MOTOR_ASSERT_TRAEFIK_BASE")
                      ?? "http://127.0.0.1:18081";
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        using var req = new HttpRequestMessage(HttpMethod.Options, $"{traefik.TrimEnd('/')}/api/public/client-config");
        req.Headers.TryAddWithoutValidation("Origin", "http://127.0.0.1");
        req.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "GET");
        var allowed = await http.SendAsync(req);
        Assert.True(
            allowed.IsSuccessStatusCode || allowed.StatusCode == HttpStatusCode.NoContent,
            $"allowed preflight {(int)allowed.StatusCode}");

        using var deniedReq = new HttpRequestMessage(HttpMethod.Options, $"{traefik.TrimEnd('/')}/api/public/client-config");
        deniedReq.Headers.TryAddWithoutValidation("Origin", "https://evil-not-allowed.example");
        deniedReq.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "GET");
        var denied = await http.SendAsync(deniedReq);
        var allowOrigin = denied.Headers.TryGetValues("Access-Control-Allow-Origin", out var vals)
            ? string.Join(",", vals)
            : "";
        Assert.DoesNotContain("evil-not-allowed.example", allowOrigin, StringComparison.OrdinalIgnoreCase);
    }

    [MotorAssertFact]
    public async Task O4_section_casing_validation()
    {
        var bad = await fx.Host.PutConfigAsync("maxsessions", 0);
        // Route is case-sensitive section name OR validator rejects.
        Assert.True(
            bad.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.NotFound,
            $"unexpected {(int)bad.StatusCode}");

        var ok = await fx.Host.PutConfigAsync("MaxSessions", 4);
        ok.EnsureSuccessStatusCode();

        var hostingBad = await fx.Host.PutConfigAsync("Hosting", new { profiles = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.BadRequest, hostingBad.StatusCode);
        await fx.RestoreHostingApexAsync();
    }

    [MotorAssertFact]
    public async Task I5_js_bridge_flip_live_session_snapshot_immutable()
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-2);
        var actId = Guid.NewGuid().ToString("N");
        await using var act = new MotorActClient(fx.Host);
        await act.ConnectAsync();
        await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/home", actId);
        await fx.Diagnostics.WaitForEventsAsync(
            act.ConnectionId, "Motor.Session", since,
            ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

        var before = await fx.Diagnostics.RequireSessionAsync(act.ConnectionId!);
        Assert.True(fx.Diagnostics.RequireBool(fx.Diagnostics.RequireSnapshot(before), "jsBridgeEnabled"));

        await fx.Host.PutConfigAsync("JsBridge", new { enable = false });
        try
        {
            await Task.Delay(500);
            var mid = await fx.Diagnostics.RequireSessionAsync(act.ConnectionId!);
            Assert.True(fx.Diagnostics.RequireBool(fx.Diagnostics.RequireSnapshot(mid), "jsBridgeEnabled"),
                "live session snapshot must keep StartSession JsBridge");

            var since2 = DateTimeOffset.UtcNow.AddSeconds(-1);
            var actId2 = Guid.NewGuid().ToString("N");
            await using var act2 = new MotorActClient(fx.Host);
            await act2.ConnectAsync();
            await act2.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/home", actId2);
            await fx.Diagnostics.WaitForEventsAsync(
                act2.ConnectionId, "Motor.Session", since2,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId2));

            var fresh = await fx.Diagnostics.RequireSessionAsync(act2.ConnectionId!);
            Assert.False(fx.Diagnostics.RequireBool(fx.Diagnostics.RequireSnapshot(fresh), "jsBridgeEnabled"));
        }
        finally
        {
            await fx.Host.PutConfigAsync("JsBridge", new { enable = true });
        }
    }

    private static string? ResolveComposeFile()
    {
        var candidates = new[]
        {
            Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "deploy", "compose", "docker-compose.motor-assert.yml")),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "deploy", "compose", "docker-compose.motor-assert.yml")),
            Environment.GetEnvironmentVariable("MOTOR_ASSERT_COMPOSE_FILE"),
        };
        return candidates.FirstOrDefault(p => !string.IsNullOrWhiteSpace(p) && File.Exists(p!));
    }
}
