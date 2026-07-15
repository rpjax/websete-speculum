using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Probes;
using Speculum.Api.Diagnostics.Telemetry;
using Speculum.Api.Motor.Live;
using static Speculum.Api.Tests.Telemetry.TelemetryTestSupport;

namespace Speculum.Api.Tests.Telemetry;

public sealed class TelemetrySampleComposerTests
{
    [Fact]
    public async Task All_sections_present_when_all_toggles_on()
    {
        var runtime = Runtime(DiagnosticsSeedProfiles.Development());
        var composer = Composer(
            [Snap("a")],
            runtime,
            sessions: [SessionMeta("s1", cookies: 1, history: 1)]);

        var sample = await composer.ComposeAsync(DiagnosticsSeedProfiles.Development().Telemetry);

        Assert.NotNull(sample.Host);
        Assert.NotNull(sample.Motor);
        Assert.NotNull(sample.Sidecar);
        Assert.NotNull(sample.Persistence);
        Assert.NotNull(sample.Pipeline);
    }

    [Fact]
    public async Task Disabled_section_toggle_omits_that_block()
    {
        var runtime = Runtime(DiagnosticsSeedProfiles.Development());
        var composer = Composer([Snap("a")], runtime);

        var telemetry = new DiagnosticsTelemetryOptions
        {
            Enabled = true,
            Host = new TelemetryHostOptions { Enabled = false },
            Motor = new TelemetryMotorOptions { Enabled = true },
            Sidecar = new TelemetrySidecarOptions { Enabled = false },
            Persistence = new TelemetryPersistenceOptions { Enabled = false },
            Pipeline = new TelemetryPipelineOptions { Enabled = true },
        };

        var sample = await composer.ComposeAsync(telemetry);

        Assert.Null(sample.Host);
        Assert.NotNull(sample.Motor);
        Assert.Null(sample.Sidecar);
        Assert.Null(sample.Persistence);
        Assert.NotNull(sample.Pipeline);
    }

    [Fact]
    public async Task Motor_and_sidecar_share_one_registry_pass()
    {
        var runtime = Runtime(DiagnosticsSeedProfiles.Development());
        var registry = new FakeRegistry([Snap("a"), Snap("b", sidecarConnected: false, lastFault: "x")]);
        var composer = new TelemetrySampleComposer(
            new HostTelemetrySource(new HostResourceProbe(), runtime),
            new MotorTelemetrySource(ConfigStore(4)),
            new SidecarTelemetrySource(),
            new PersistenceTelemetrySource(
                new FakeBrowserSessionStore([]),
                Bootstrap(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")))),
            new PipelineTelemetrySource(runtime, RealBus(runtime)),
            registry);

        var sample = await composer.ComposeAsync(DiagnosticsSeedProfiles.Development().Telemetry);

        Assert.Equal(2, sample.Motor!.Total);
        Assert.Equal(1, sample.Sidecar!.Connected);
        Assert.Equal(1, sample.Sidecar!.Faulted);
    }

    /// <summary>
    /// Symptom → signal: every field the operator needs to correlate host × motor × sidecar ×
    /// pipeline over one time axis must be present with the toggles on (docs/diagnostics.md).
    /// </summary>
    [Fact]
    public async Task Story_fields_present_with_toggles_on()
    {
        var runtime = Runtime(DiagnosticsSeedProfiles.Development());
        var composer = Composer(
            [
                Snap("a", MotorSessionPhase.Running, fps: 5, inputQueue: 3),
                Snap("b", MotorSessionPhase.Starting, sidecarConnected: false, lastFault: "sidecar_fault"),
            ],
            runtime,
            maxSessions: 2,
            sessions: [SessionMeta("s1", cookies: 2, history: 3)]);

        var sample = await composer.ComposeAsync(DiagnosticsSeedProfiles.Development().Telemetry);

        // Memory leak / GC pressure signal.
        Assert.True(sample.Host!.MemoryUsed > 0);
        Assert.True(sample.Host!.GcGen2 >= 0);
        Assert.True(sample.Host!.GcHeap > 0);
        Assert.True(sample.Host!.ThreadPoolQueued >= 0);

        // Perf/render + saturation signals.
        Assert.Equal(5, sample.Motor!.AvgFps);
        Assert.Equal(1, sample.Motor!.Starting);
        Assert.Equal(3, sample.Motor!.InputQueueTotal);
        Assert.Equal(100, sample.Motor!.CapacityUsedPct);

        // Sidecar instability signal.
        Assert.Equal(1, sample.Sidecar!.Faulted);

        // Diagnostics overhead signal.
        Assert.NotNull(sample.Pipeline!.RecentSlowWrites);
        Assert.True(sample.Pipeline!.BytesUsed >= 0);
    }
}
