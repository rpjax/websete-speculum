using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Pipeline;
using Microsoft.Extensions.Logging.Abstractions;

namespace Speculum.Api.Tests;

public sealed class DiagnosticsSinkOverflowTests : IDisposable
{
    private readonly string _dbPath;
    private readonly string _tempDir;

    public DiagnosticsSinkOverflowTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "speculum-diag-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDir);
        _dbPath = Path.Combine(_tempDir, "speculum.db");
    }

    public void Dispose()
    {
        try { Directory.Delete(_tempDir, recursive: true); }
        catch { /* best-effort */ }
    }

    [Fact]
    public async Task Overflow_publishes_StorageOverflow_and_increments_counter()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(new DiagnosticsOptions
        {
            Enabled = true,
            Storage = new DiagnosticsStorageOptions
            {
                MaxBytes = 2048,
                MaxEventsPerSession = 5000,
                TtlHours = 24,
                Overflow = "DropOldest",
            },
        });

        var recorder = new RecordingBus();
        var sink = new SqliteDiagnosticsEventSink(
            _dbPath,
            runtime,
            new Lazy<IDiagnosticsEventBus>(() => recorder));

        for (var i = 0; i < 80; i++)
        {
            await sink.WriteAsync(new DiagnosticsEvent
            {
                Domain = DiagnosticsDomain.MotorLive,
                Name = "Motor.SessionStarted",
                ConnectionId = "conn",
                Payload = new { i, pad = new string('x', 200) },
            });
        }

        Assert.True(runtime.GetSnapshot().OverflowCount > 0);
        Assert.Contains(recorder.Events, e => e.Name == "Diagnostics.StorageOverflow");
    }

    [Fact]
    public void Off_runtime_does_not_publish_to_ring_or_sink()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(new DiagnosticsOptions { Enabled = false });
        var sink = new RecordingSink();
        var ring = new SessionEventRing();
        var bus = new DiagnosticsEventBus(
            runtime,
            new IDiagnosticsSink[] { sink },
            ring,
            NullLogger<DiagnosticsEventBus>.Instance);

        bus.Publish(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.MotorLive,
            Name = "Motor.SessionStarted",
            ConnectionId = "conn-1",
        });

        Assert.Empty(ring.GetSince("conn-1", null, null));
        Assert.Empty(sink.Events);
    }

    [Fact]
    public void Enabled_runtime_persists_session_lifecycle_without_sampling_loss()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(new DiagnosticsOptions
        {
            Enabled = true,
            Sampling = new DiagnosticsSamplingOptions
            {
                StatusMirrorRatio = 0.01,
                ExpensiveEventRatio = 0.01,
            },
        });
        var sink = new RecordingSink();
        var ring = new SessionEventRing();
        var bus = new DiagnosticsEventBus(
            runtime,
            new IDiagnosticsSink[] { sink },
            ring,
            NullLogger<DiagnosticsEventBus>.Instance);

        bus.Publish(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.MotorLive,
            Name = "Motor.StateExportCompleted",
            ConnectionId = "conn-1",
        });
        bus.Publish(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.SidecarBrowser,
            Name = "Sidecar.DiagProbeCompleted",
            ConnectionId = "conn-1",
        });

        Assert.Equal(2, sink.Events.Count);
        Assert.Equal(2, ring.GetSince("conn-1", null, null).Count);
    }

    private sealed class RecordingSink : IDiagnosticsSink
    {
        public List<DiagnosticsEvent> Events { get; } = [];
        public ValueTask WriteAsync(DiagnosticsEvent diagnosticsEvent, CancellationToken ct = default)
        {
            Events.Add(diagnosticsEvent);
            return ValueTask.CompletedTask;
        }
    }

    private sealed class RecordingBus : IDiagnosticsEventBus
    {
        public List<DiagnosticsEvent> Events { get; } = [];
        public void Publish(DiagnosticsEvent diagnosticsEvent, bool persist = true)
            => Events.Add(diagnosticsEvent);
    }
}
