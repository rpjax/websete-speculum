namespace Speculum.MotorAssert.Tests;

[CollectionDefinition(nameof(MotorAssertCollection), DisableParallelization = true)]
public sealed class MotorAssertCollection : ICollectionFixture<MotorAssertFixture>;

public sealed class MotorAssertFixture : IAsyncLifetime
{
    public MotorAssertHost Host { get; } = new();
    public DiagnosticsAssertClient Diagnostics { get; }

    public MotorAssertFixture() => Diagnostics = new DiagnosticsAssertClient(Host);

    public async Task InitializeAsync()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("MOTOR_ASSERT_API_BASE")))
            return;
        await Host.EnsureReadyAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>Baseline Diagnostics config used by seed + test finally blocks.</summary>
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
}
