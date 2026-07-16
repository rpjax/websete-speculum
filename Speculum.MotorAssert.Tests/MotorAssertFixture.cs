using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

/// <summary>
/// Shared MotorAssert stack helpers: known-good baseline before each test.
/// Shared config mutation must not leak into the next Act→Assert case.
/// </summary>
[CollectionDefinition(nameof(MotorAssertCollection), DisableParallelization = true)]
public sealed class MotorAssertCollection : ICollectionFixture<MotorAssertFixture>;

public sealed class MotorAssertFixture : IAsyncLifetime
{
    public MotorAssertHost Host { get; } = new();
    public DiagnosticsAssertClient Diagnostics { get; }

    public MotorAssertFixture() => Diagnostics = new DiagnosticsAssertClient(Host);

    public async Task InitializeAsync()
    {
        if (!IsMotorAssertEnvironment)
            return;
        await Host.EnsureReadyAsync();
        await EnsureBaselineAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    public static bool IsMotorAssertEnvironment =>
        !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("MOTOR_ASSERT_API_BASE"));

    /// <summary>Baseline Diagnostics config used by seed + restores (full toggles-on for probes/snapshots).</summary>
    public static object AssertiveDiagnosticsConfig(int maxProbeResponseBytes = 524288) => new
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
        telemetry = new
        {
            enabled = true,
            intervalSeconds = 5,
            host = new
            {
                enabled = true,
                procPath = "/host/proc",
                sampleIntervalMs = 1000,
                includeLoadAverage = true,
                includeSwap = true,
                includeDiskIo = true,
                includeNetwork = true,
            },
            apiProcess = new
            {
                enabled = true,
                sampleIntervalMs = 1000,
                includePrivateMemory = true,
                includeGc = true,
                includeThreadPool = true,
            },
            motor = new
            {
                enabled = true,
                includeSessionIds = true,
                includePerSession = true,
                includeUrlHost = true,
            },
            sidecar = new { enabled = true, includeFaultedIds = true },
            persistence = new { enabled = true, includeBytes = true },
            pipeline = new { enabled = true, includeBreakerPressure = true },
        },
        probe = new
        {
            maxConcurrentProbesPerSession = 2,
            diagTimeoutMs = 10000,
            maxProbeResponseBytes,
        },
    };

    public Task<HttpResponseMessage> RestoreForwardingAsync() => Host.PutConfigAsync("Forwarding", new
    {
        host = "fixture.test",
        domains = new[] { "fixture.test", "*.fixture.test" },
    });

    public Task<HttpResponseMessage> RestoreHostingApexAsync() => Host.PutConfigAsync("Hosting", new
    {
        profiles = new object[]
        {
            new { domain = "speculum.test", subdomainMirroringEnabled = false },
        },
    });

    public Task<HttpResponseMessage> RestoreAssertiveDiagnosticsAsync(int maxProbeResponseBytes = 524288) =>
        Host.PutConfigAsync("Diagnostics", AssertiveDiagnosticsConfig(maxProbeResponseBytes));

    /// <summary>
    /// PUT Assertive Diagnostics, wait for <c>Diagnostics.ConfigApplied</c>, then assert
    /// effective levels allow browser probes. Fail hard if restore did not take effect.
    /// </summary>
    public async Task RestoreAssertiveDiagnosticsVerifiedAsync(
        int maxProbeResponseBytes = 524288,
        CancellationToken ct = default)
    {
        var since = DateTimeOffset.UtcNow.AddSeconds(-1);
        var put = await RestoreAssertiveDiagnosticsAsync(maxProbeResponseBytes);
        put.EnsureSuccessStatusCode();
        await Diagnostics.WaitConfigAppliedAsync(since, ct: ct);
        await EnsureNotDegradedAsync(ct);
        await RequireAssertiveProbeLevelsAsync(ct);
    }

    /// <summary>
    /// Per-test isolation: MaxSessions / JsBridge / Diagnostics Assertive known-good.
    /// Clears Diagnostics Degraded (which caps BrowserQuery→Metrics) before level checks.
    /// </summary>
    public async Task EnsureBaselineAsync(CancellationToken ct = default)
    {
        if (!IsMotorAssertEnvironment)
            return;

        // Drain leftover slots before restoring MaxSessions so capacity tests start clean.
        await Diagnostics.WaitUntilRegistryIdleAsync(TimeSpan.FromSeconds(45), ct);

        var max = await Host.PutConfigAsync("MaxSessions", 4, ct);
        max.EnsureSuccessStatusCode();
        var bridge = await Host.PutConfigAsync("JsBridge", new { enable = true }, ct);
        bridge.EnsureSuccessStatusCode();

        await EnsureNotDegradedAsync(ct);

        if (await TryIsAssertiveProbeReadyAsync(ct))
            return;

        await RestoreAssertiveDiagnosticsVerifiedAsync(ct: ct);
    }

    /// <summary>
    /// Degraded caps effective levels at Metrics; PUT Diagnostics cannot clear it.
    /// POST /recover (and cleanup) are the supported recovery paths.
    /// </summary>
    public async Task EnsureNotDegradedAsync(CancellationToken ct = default)
    {
        var runtime = await Diagnostics.GetRuntimeAsync(ct);
        if (!runtime.TryGetProperty("degraded", out var deg) || !deg.GetBoolean())
            return;

        var recover = await Host.Http.PostAsync("api/admin/diagnostics/v1/recover", content: null, ct);
        recover.EnsureSuccessStatusCode();

        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            runtime = await Diagnostics.GetRuntimeAsync(ct);
            if (runtime.TryGetProperty("degraded", out deg) && !deg.GetBoolean())
                return;
            await Task.Delay(100, ct);
        }

        Assert.Fail($"Diagnostics still degraded after POST /recover: {runtime}");
    }

    public async Task RequireAssertiveProbeLevelsAsync(CancellationToken ct = default)
    {
        var runtime = await Diagnostics.GetRuntimeAsync(ct);
        Assert.True(
            runtime.TryGetProperty("enabled", out var enabled) && enabled.GetBoolean(),
            $"Diagnostics must be enabled: {runtime}");

        if (runtime.TryGetProperty("degraded", out var deg) && deg.GetBoolean())
        {
            Assert.Fail(
                "Diagnostics is degraded (effective capabilities capped at Metric). " +
                "Clear via POST /api/admin/diagnostics/v1/recover before BrowserQuery probes. " +
                $"runtime={runtime}");
        }

        Assert.True(
            runtime.TryGetProperty("effectiveCapabilities", out var caps),
            $"runtime missing effectiveCapabilities: {runtime}");

        RequireCapability(caps, "BrowserQuery", "Probe");
        RequireCapability(caps, "SidecarBrowser", "Metric");
    }

    public async Task<bool> TryIsAssertiveProbeReadyAsync(CancellationToken ct = default)
    {
        try
        {
            await RequireAssertiveProbeLevelsAsync(ct);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static void RequireCapability(JsonElement caps, string domainKey, string capabilityKey)
    {
        Assert.True(
            TryGetPropertyIgnoreCase(caps, domainKey, out var domainEl),
            $"effectiveCapabilities missing '{domainKey}': {caps}");
        Assert.True(
            TryGetPropertyIgnoreCase(domainEl, capabilityKey, out var capEl)
            && capEl.ValueKind is JsonValueKind.True or JsonValueKind.False
            && capEl.GetBoolean(),
            $"effectiveCapabilities.{domainKey}.{capabilityKey} not enabled: {domainEl}");
    }

    private static bool TryGetPropertyIgnoreCase(JsonElement obj, string name, out JsonElement el)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out el))
            return true;

        if (obj.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in obj.EnumerateObject())
            {
                if (string.Equals(prop.Name, name, StringComparison.OrdinalIgnoreCase))
                {
                    el = prop.Value;
                    return true;
                }
            }
        }

        el = default;
        return false;
    }
}

/// <summary>
/// xUnit creates a new class instance per test; <see cref="InitializeAsync"/> runs before each method.
/// </summary>
public abstract class MotorAssertTestBase(MotorAssertFixture fixture) : IAsyncLifetime
{
    protected MotorAssertFixture Fx { get; } = fixture;

    /// <summary>Alias for test bodies (avoids CS9107 with explicit ctor + base).</summary>
    protected MotorAssertFixture fx => Fx;

    public Task InitializeAsync() => Fx.EnsureBaselineAsync();

    public Task DisposeAsync() => Task.CompletedTask;
}
