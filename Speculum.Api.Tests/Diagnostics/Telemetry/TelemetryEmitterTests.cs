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

        var evt = Assert.Single(bus.Events, e => e.Name == "Telemetry.SampleCollected");
        Assert.Equal(DiagnosticsDomain.Telemetry, evt.Domain);
        Assert.Null(evt.ConnectionId); // composite is global — not scoped to any session
        var sample = Assert.IsType<TelemetrySample>(evt.Payload);
        Assert.NotNull(sample.Host);
        Assert.NotNull(sample.Motor);
    }

    [Fact]
    public async Task EmitSample_mirrors_each_live_session_scoped_by_connection_when_per_session_enabled()
    {
        // Development enables Telemetry.Motor.IncludePerSession.
        var runtime = Runtime(DiagnosticsSeedProfiles.Development());
        var bus = new CapturingBus();
        var composer = Composer([Snap("a"), Snap("b")], runtime);
        var emitter = new TelemetryEmitter(runtime, composer, bus);

        await emitter.EmitSampleAsync();

        var perSession = bus.Events.Where(e => e.Name == "Telemetry.SessionSampleCollected").ToList();
        Assert.Equal(2, perSession.Count);
        Assert.All(perSession, e => Assert.Equal(DiagnosticsDomain.Telemetry, e.Domain));
        Assert.Contains(perSession, e => e.ConnectionId == "a");
        Assert.Contains(perSession, e => e.ConnectionId == "b");
    }

    [Fact]
    public async Task EmitSample_does_not_mirror_sessions_when_per_session_disabled()
    {
        var runtime = Runtime(new DiagnosticsOptions
        {
            Enabled = true,
            Telemetry = new DiagnosticsTelemetryOptions
            {
                Enabled = true,
                Motor = new TelemetryMotorOptions { Enabled = true, IncludePerSession = false },
            },
        });
        var bus = new CapturingBus();
        var composer = Composer([Snap("a"), Snap("b")], runtime);
        var emitter = new TelemetryEmitter(runtime, composer, bus);

        await emitter.EmitSampleAsync();

        // Only the global composite — no per-session mirror when the projection is off.
        var evt = Assert.Single(bus.Events);
        Assert.Equal("Telemetry.SampleCollected", evt.Name);
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
