using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Emitters;
using Speculum.Api.Diagnostics.Pipeline;

namespace Speculum.Api.Tests;

/// <summary>
/// Act→Assert on the publish circuit breaker: sustained sink failures trip
/// <c>Diagnostics.Degraded</c> exactly once, and the counting window resets after 10s.
/// </summary>
public sealed class DiagnosticsBreakerTests
{
    // NoteDrop trips only when the counter exceeds 200 within the window.
    private const int TripThreshold = 200;

    private const string PersistedCatalogEvent = "Motor.SessionStarted";

    [Fact]
    public void Sustained_drops_trip_degraded_once_with_drop_rate_reason()
    {
        var runtime = DevelopmentRuntime();
        var self = new RecordingSelfEmitter();
        var bus = BuildBus(runtime, new ThrowingSink(), self);

        for (var i = 0; i < TripThreshold + 1; i++)
            PublishPersisted(bus);

        Assert.True(runtime.IsDegraded);
        Assert.Equal(1, self.DegradedCalls);
        Assert.Equal("drop_rate", self.LastDegradedReason);
    }

    [Fact]
    public void Trip_is_idempotent_while_already_degraded()
    {
        var runtime = DevelopmentRuntime();
        var self = new RecordingSelfEmitter();
        var bus = BuildBus(runtime, new ThrowingSink(), self);

        for (var i = 0; i < TripThreshold + 50; i++)
            PublishPersisted(bus);

        // Breaker already open — extra drops must not re-emit Degraded.
        Assert.True(runtime.IsDegraded);
        Assert.Equal(1, self.DegradedCalls);
    }

    [Fact]
    public void Below_threshold_does_not_trip()
    {
        var runtime = DevelopmentRuntime();
        var self = new RecordingSelfEmitter();
        var bus = BuildBus(runtime, new ThrowingSink(), self);

        for (var i = 0; i < TripThreshold; i++)
            PublishPersisted(bus);

        Assert.False(runtime.IsDegraded);
        Assert.Equal(0, self.DegradedCalls);
    }

    [Fact]
    public void Window_resets_after_ten_seconds_so_stale_drops_do_not_accumulate()
    {
        var runtime = DevelopmentRuntime();
        var self = new RecordingSelfEmitter();
        var clock = new MutableTimeProvider(DateTimeOffset.UnixEpoch);
        var bus = BuildBus(runtime, new ThrowingSink(), self, clock);

        // Fill the window just under the trip threshold.
        for (var i = 0; i < TripThreshold; i++)
            PublishPersisted(bus);
        Assert.False(runtime.IsDegraded);

        // Cross the 10s window boundary; the next drop rolls the window to 1.
        clock.Advance(TimeSpan.FromSeconds(11));
        PublishPersisted(bus);

        Assert.False(runtime.IsDegraded);
        Assert.Equal(0, self.DegradedCalls);
        Assert.Equal(1, bus.GetBreakerPressure().RecentDrops);
    }

    private static DiagnosticsRuntime DevelopmentRuntime()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(DiagnosticsSeedProfiles.Development());
        return runtime;
    }

    private static void PublishPersisted(IDiagnosticsEventBus bus)
        => bus.Publish(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.MotorLive,
            Name = PersistedCatalogEvent,
            ConnectionId = "conn-breaker",
        });

    private static DiagnosticsEventBus BuildBus(
        DiagnosticsRuntime runtime,
        IDiagnosticsSink sink,
        IDiagnosticsSelfEmitter self,
        TimeProvider? timeProvider = null)
    {
        var lazySelf = new Lazy<IDiagnosticsSelfEmitter>(() => self);
        DiagnosticsEventBus bus = null!;
        var spans = new SpanTracker(new Lazy<IDiagnosticsEventBus>(() => bus), timeProvider);
        bus = new DiagnosticsEventBus(
            runtime, [sink], new SessionEventRing(), lazySelf, spans,
            NullLogger<DiagnosticsEventBus>.Instance, timeProvider);
        return bus;
    }

    private sealed class ThrowingSink : IDiagnosticsSink
    {
        public ValueTask WriteAsync(DiagnosticsEvent diagnosticsEvent, CancellationToken ct = default)
            => throw new InvalidOperationException("sink write failed (breaker test)");
    }

    private sealed class RecordingSelfEmitter : IDiagnosticsSelfEmitter
    {
        public int DegradedCalls { get; private set; }
        public string? LastDegradedReason { get; private set; }

        public void Degraded(string reason)
        {
            DegradedCalls++;
            LastDegradedReason = reason;
        }

        public void ConfigApplied(bool enabled, string profile) { }
        public void ElevateStarted(int minutes, string actorIp) { }
        public void ElevateExpired(string reason, string? actorIp = null) { }
        public void StorageOverflow(long maxBytes, int dropped, string overflow) { }
        public void Recovered(string reason, string? actorIp = null) { }
        public void CleanupPurged(int purged) { }
    }

    private sealed class MutableTimeProvider(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }
}
