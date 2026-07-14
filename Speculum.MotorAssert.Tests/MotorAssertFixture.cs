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

    /// <summary>Baseline Diagnostics config used by seed + restores.</summary>
    public static object AssertiveDiagnosticsConfig(int maxProbeResponseBytes = 524288) => new
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
        await RequireAssertiveProbeLevelsAsync(ct);
    }

    /// <summary>
    /// Per-test isolation: MaxSessions / JsBridge / Diagnostics Assertive known-good.
    /// Cheap GET short-circuits Diagnostics restore when already Assertive.
    /// </summary>
    public async Task EnsureBaselineAsync(CancellationToken ct = default)
    {
        if (!IsMotorAssertEnvironment)
            return;

        var max = await Host.PutConfigAsync("MaxSessions", 4, ct);
        max.EnsureSuccessStatusCode();
        var bridge = await Host.PutConfigAsync("JsBridge", new { enable = true }, ct);
        bridge.EnsureSuccessStatusCode();

        if (await TryIsAssertiveProbeReadyAsync(ct))
            return;

        await RestoreAssertiveDiagnosticsVerifiedAsync(ct: ct);
    }

    public async Task RequireAssertiveProbeLevelsAsync(CancellationToken ct = default)
    {
        var runtime = await Diagnostics.GetRuntimeAsync(ct);
        Assert.True(
            runtime.TryGetProperty("enabled", out var enabled) && enabled.GetBoolean(),
            $"Diagnostics must be enabled: {runtime}");

        Assert.True(
            runtime.TryGetProperty("effectiveLevels", out var levels),
            $"runtime missing effectiveLevels: {runtime}");

        RequireLevelAtLeast(levels, "BrowserQuery", "BrowserQuery");
        RequireLevelAtLeast(levels, "SidecarBrowser", "Metrics");
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

    private static void RequireLevelAtLeast(JsonElement levels, string domainKey, string minimumName)
    {
        Assert.True(
            levels.TryGetProperty(domainKey, out var el),
            $"effectiveLevels missing '{domainKey}': {levels}");
        var actual = el.GetString() ?? "";
        Assert.True(
            CompareDiagLevel(actual, minimumName) >= 0,
            $"effectiveLevels.{domainKey}={actual}, need ≥ {minimumName}");
    }

    /// <summary>Off &lt; Metrics &lt; Events &lt; StateSnapshots &lt; BrowserQuery</summary>
    private static int CompareDiagLevel(string actual, string minimum)
        => Rank(actual).CompareTo(Rank(minimum));

    private static int Rank(string name) => name.ToUpperInvariant() switch
    {
        "OFF" => 0,
        "METRICS" => 1,
        "EVENTS" => 2,
        "STATESNAPSHOTS" => 3,
        "BROWSERQUERY" => 4,
        _ => -1,
    };
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
