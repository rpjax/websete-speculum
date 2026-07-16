using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Emitters;
using Speculum.Api.Diagnostics.Pipeline;

namespace Speculum.Api.Tests;

/// <summary>
/// Act→Assert on <see cref="SpanTracker"/>: the pipeline seam that stamps a monotonic <c>Seq</c>,
/// pairs Open/Close beats into spans (scoped by connection/correlation), threads causation onto
/// standalone beats, and force-closes leftovers on timeout / teardown / boot recovery — each with a
/// catalogued <c>Diagnostics.SpanAbandoned</c> carrying <c>errorCode</c>+<c>phase</c>.
/// </summary>
public sealed class SpanTrackerTests : IDisposable
{
    private static readonly DateTimeOffset Base = new(2026, 7, 15, 12, 0, 0, TimeSpan.Zero);
    private readonly List<string> _tempDirs = [];

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); }
            catch { /* best-effort */ }
        }
    }

    [Fact]
    public void Stamp_assigns_monotonic_sequence()
    {
        var (tracker, _) = Build();

        var e1 = Stamp(tracker, "Motor.SessionStarting", conn: "c1");
        var e2 = Stamp(tracker, "Motor.SlotAcquired", conn: "c1");
        var e3 = Stamp(tracker, "Motor.SessionStopped", conn: "c1");

        Assert.Equal(1, e1.Seq);
        Assert.Equal(2, e2.Seq);
        Assert.Equal(3, e3.Seq);
    }

    [Fact]
    public void Open_mints_span_id_and_close_echoes_it()
    {
        var (tracker, _) = Build();

        var open = Stamp(tracker, "Motor.NavigateRequested", conn: "c1");
        Assert.False(string.IsNullOrEmpty(open.SpanId));
        Assert.Equal("motor.navigate", open.SpanKey);
        Assert.Equal(1, tracker.OpenSpanCount);

        var close = Stamp(tracker, "Motor.NavigateCompleted", conn: "c1");
        Assert.Equal(open.SpanId, close.SpanId);
        Assert.Equal("motor.navigate", close.SpanKey);
        Assert.Equal(0, tracker.OpenSpanCount);
    }

    [Fact]
    public void Standalone_beat_causes_to_innermost_open_span()
    {
        var (tracker, _) = Build();

        var session = Stamp(tracker, "Motor.SessionStarting", conn: "c1");
        var beat = Stamp(tracker, "Motor.SlotAcquired", conn: "c1");

        Assert.Equal(session.SpanId, beat.CausationId);
    }

    [Fact]
    public void Innermost_open_span_wins_causation_when_nested()
    {
        var (tracker, _) = Build();

        var session = Stamp(tracker, "Motor.SessionStarting", conn: "c1");
        var navigate = Stamp(tracker, "Motor.NavigateRequested", conn: "c1");
        var beat = Stamp(tracker, "Motor.UrlMapped", conn: "c1");

        // navigate opened after session -> it is the innermost -> beat causes to it.
        Assert.Equal(navigate.SpanId, beat.CausationId);
        Assert.NotEqual(session.SpanId, beat.CausationId);
    }

    [Fact]
    public void Open_span_nests_under_the_innermost_open_span_via_causation()
    {
        var (tracker, _) = Build();

        var session = Stamp(tracker, "Motor.SessionStarting", conn: "c1"); // top-level span
        var navigate = Stamp(tracker, "Motor.NavigateRequested", conn: "c1"); // opened inside session

        Assert.Null(session.CausationId); // top-level: no parent
        Assert.Equal(session.SpanId, navigate.CausationId); // navigate nests under session
    }

    [Fact]
    public void Scopes_do_not_cross_correlate()
    {
        var (tracker, _) = Build();

        var openA = Stamp(tracker, "Motor.NavigateRequested", conn: "cA");
        var closeB = Stamp(tracker, "Motor.NavigateCompleted", conn: "cB");

        // No live open in scope cB -> close is a standalone beat (key set, id unresolved).
        Assert.Null(closeB.SpanId);
        Assert.Equal("motor.navigate", closeB.SpanKey);
        // openA in scope cA remains open.
        Assert.Equal(1, tracker.OpenSpanCount);
        Assert.False(string.IsNullOrEmpty(openA.SpanId));
    }

    [Fact]
    public void SweepTimeouts_abandons_expired_span_with_error_and_phase()
    {
        var clock = new MutableTimeProvider(Base);
        var (tracker, bus) = Build(clock);

        var open = Stamp(tracker, "Motor.NavigateRequested", conn: "c1"); // 60s timeout
        clock.Advance(TimeSpan.FromSeconds(61));
        tracker.SweepTimeouts(clock.GetUtcNow());

        Assert.Equal(0, tracker.OpenSpanCount);
        var abandoned = Assert.Single(bus.Events);
        Assert.Equal("Diagnostics.SpanAbandoned", abandoned.Name);
        Assert.Equal(open.SpanId, abandoned.SpanId);
        Assert.Equal("motor.navigate", abandoned.SpanKey);
        var payload = Assert.IsType<SpanAbandonedPayload>(abandoned.Payload);
        Assert.Equal("span_timeout", payload.ErrorCode);
        Assert.Equal("timeout", payload.Phase);
        Assert.True(payload.OpenMs >= 61_000);
    }

    [Fact]
    public void SweepTimeouts_leaves_spans_without_deadline_open()
    {
        var clock = new MutableTimeProvider(Base);
        var (tracker, bus) = Build(clock);

        Stamp(tracker, "Motor.SessionStarting", conn: "c1"); // no timeout (long-lived)
        clock.Advance(TimeSpan.FromHours(2));
        tracker.SweepTimeouts(clock.GetUtcNow());

        Assert.Equal(1, tracker.OpenSpanCount);
        Assert.Empty(bus.Events);
    }

    [Fact]
    public void SweepTimeouts_before_deadline_is_a_noop()
    {
        var clock = new MutableTimeProvider(Base);
        var (tracker, bus) = Build(clock);

        Stamp(tracker, "Motor.NavigateRequested", conn: "c1"); // 60s
        clock.Advance(TimeSpan.FromSeconds(30));
        tracker.SweepTimeouts(clock.GetUtcNow());

        Assert.Equal(1, tracker.OpenSpanCount);
        Assert.Empty(bus.Events);
    }

    [Fact]
    public void CloseScope_abandons_every_open_span_in_that_scope_only()
    {
        var (tracker, bus) = Build();

        Stamp(tracker, "Motor.NavigateRequested", conn: "c1");
        Stamp(tracker, "Motor.StateExportRequested", conn: "c1");
        Stamp(tracker, "Motor.NavigateRequested", conn: "c2");

        tracker.CloseScope("c1", "disconnect");

        Assert.Equal(1, tracker.OpenSpanCount); // c2 untouched
        Assert.Equal(2, bus.Events.Count);
        Assert.All(bus.Events, e =>
        {
            Assert.Equal("Diagnostics.SpanAbandoned", e.Name);
            var p = Assert.IsType<SpanAbandonedPayload>(e.Payload);
            Assert.Equal("disconnect", p.ErrorCode);
            Assert.Equal("disconnect", p.Phase);
        });
    }

    [Fact]
    public void CloseScope_with_no_scope_is_a_noop()
    {
        var (tracker, bus) = Build();
        Stamp(tracker, "Motor.NavigateRequested", conn: "c1");

        tracker.CloseScope(null, "x");
        tracker.CloseScope("", "x");

        Assert.Equal(1, tracker.OpenSpanCount);
        Assert.Empty(bus.Events);
    }

    [Fact]
    public async Task RecoverFromStore_abandons_orphans_and_seeds_seq_past_persisted_max()
    {
        var sink = NewSink();

        // Orphan open beat (appears once) -> recovered + abandoned.
        await sink.WriteAsync(new DiagnosticsEvent
        {
            Id = "e-orphan", Seq = 7, Domain = DiagnosticsDomain.MotorLive,
            Name = "Motor.SessionStarting", ConnectionId = "c1",
            SpanId = "span-orphan", SpanKey = "motor.session",
        });
        // Properly-closed pair (appears twice) -> NOT recovered.
        await sink.WriteAsync(new DiagnosticsEvent
        {
            Id = "e-open", Seq = 8, Domain = DiagnosticsDomain.MotorLive,
            Name = "Motor.NavigateRequested", ConnectionId = "c1",
            SpanId = "span-closed", SpanKey = "motor.navigate",
        });
        await sink.WriteAsync(new DiagnosticsEvent
        {
            Id = "e-close", Seq = 9, Domain = DiagnosticsDomain.MotorLive,
            Name = "Motor.NavigateCompleted", ConnectionId = "c1",
            SpanId = "span-closed", SpanKey = "motor.navigate",
        });

        var (tracker, bus) = Build();
        tracker.RecoverFromStore(sink);

        var abandoned = Assert.Single(bus.Events);
        Assert.Equal("Diagnostics.SpanAbandoned", abandoned.Name);
        Assert.Equal("span-orphan", abandoned.SpanId);
        var payload = Assert.IsType<SpanAbandonedPayload>(abandoned.Payload);
        Assert.Equal("span_abandoned", payload.ErrorCode);
        Assert.Equal("recover", payload.Phase);

        // Seq seeded past the persisted max (9) so ordering stays monotonic across restarts.
        var next = Stamp(tracker, "Motor.SlotAcquired", conn: "c1");
        Assert.Equal(10, next.Seq);
    }

    [Fact]
    public async Task RecoverFromStore_ignores_a_surviving_close_whose_open_was_trimmed()
    {
        var sink = NewSink();

        // Storage trim / TTL drops oldest-first: an Open can be purged while its later Close
        // survives, leaving the Close appearing once. It must NOT be treated as an orphan open.
        await sink.WriteAsync(new DiagnosticsEvent
        {
            Id = "e-close-only", Seq = 3, Domain = DiagnosticsDomain.MotorLive,
            Name = "Motor.NavigateCompleted", ConnectionId = "c1",
            SpanId = "span-trimmed", SpanKey = "motor.navigate",
        });

        var (tracker, bus) = Build();
        tracker.RecoverFromStore(sink);

        Assert.Empty(bus.Events); // no fabricated abandon for an already-closed span
    }

    private static (SpanTracker tracker, RecordingBus bus) Build(TimeProvider? time = null)
    {
        var bus = new RecordingBus();
        var tracker = new SpanTracker(new Lazy<IDiagnosticsEventBus>(() => bus), time);
        return (tracker, bus);
    }

    private static DiagnosticsEvent Stamp(SpanTracker tracker, string name, string? conn = null, string? corr = null)
    {
        Assert.True(DiagnosticsEventCatalog.TryGet(name, out var descriptor), $"unknown catalog event {name}");
        var evt = new DiagnosticsEvent
        {
            Domain = descriptor.Domain,
            Name = name,
            ConnectionId = conn,
            CorrelationId = corr,
        };
        tracker.Stamp(evt, descriptor);
        return evt;
    }

    private SqliteDiagnosticsEventSink NewSink()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "speculum-span-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        _tempDirs.Add(tempDir);

        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(new DiagnosticsOptions
        {
            Enabled = true,
            Storage = new DiagnosticsStorageOptions
            {
                MaxBytes = 64 * 1024 * 1024,
                MaxEventsPerSession = 5000,
                TtlHours = 240,
                Overflow = "DropOldest",
            },
        });

        return new SqliteDiagnosticsEventSink(
            Path.Combine(tempDir, "speculum.db"),
            runtime,
            new Lazy<IDiagnosticsSelfEmitter>(() => new DiagnosticsSelfEmitter(new RecordingBus())));
    }

    private sealed class RecordingBus : IDiagnosticsEventBus
    {
        public List<DiagnosticsEvent> Events { get; } = [];
        public void Publish(DiagnosticsEvent diagnosticsEvent, bool persist = true)
            => Events.Add(diagnosticsEvent);
    }

    private sealed class MutableTimeProvider(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }
}
