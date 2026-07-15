using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Telemetry;
using static Speculum.Api.Tests.Telemetry.TelemetryTestSupport;

namespace Speculum.Api.Tests.Telemetry;

public sealed class TelemetryEmitterTests
{
    [Fact]
    public async Task EmitSample_publishes_composite_when_enabled()
    {
        var runtime = Runtime(DiagnosticsSeedProfiles.Development());
        var bus = new CapturingBus();
        var composer = Composer([Snap("a")], runtime);
        var emitter = new TelemetryEmitter(runtime, composer, bus);

        await emitter.EmitSampleAsync();

        var evt = Assert.Single(bus.Events);
        Assert.Equal("Telemetry.SampleCollected", evt.Name);
        Assert.Equal(DiagnosticsDomain.Telemetry, evt.Domain);
        var sample = Assert.IsType<TelemetrySample>(evt.Payload);
        Assert.NotNull(sample.Host);
        Assert.NotNull(sample.Motor);
    }

    [Fact]
    public async Task EmitSample_noop_when_telemetry_disabled()
    {
        var runtime = Runtime(new DiagnosticsOptions
        {
            Enabled = true,
            Telemetry = new DiagnosticsTelemetryOptions { Enabled = false },
        });
        var bus = new CapturingBus();
        var emitter = new TelemetryEmitter(runtime, new ThrowingComposer(), bus);

        await emitter.EmitSampleAsync();

        // Composer must not be invoked (would throw) and nothing published.
        Assert.Empty(bus.Events);
    }

    [Fact]
    public async Task EmitSample_noop_when_diagnostics_disabled()
    {
        var runtime = Runtime(new DiagnosticsOptions { Enabled = false });
        var bus = new CapturingBus();
        var emitter = new TelemetryEmitter(runtime, new ThrowingComposer(), bus);

        await emitter.EmitSampleAsync();

        Assert.Empty(bus.Events);
    }

    private sealed class ThrowingComposer : ITelemetrySampleComposer
    {
        public Task<TelemetrySample> ComposeAsync(DiagnosticsTelemetryOptions telemetry, CancellationToken ct = default)
            => throw new InvalidOperationException("composer must not run when telemetry is disabled");
    }
}
