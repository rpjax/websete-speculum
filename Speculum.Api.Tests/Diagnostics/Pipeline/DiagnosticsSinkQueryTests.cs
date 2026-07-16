using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Emitters;
using Speculum.Api.Diagnostics.Pipeline;

namespace Speculum.Api.Tests;

public sealed class DiagnosticsSinkQueryTests : IDisposable
{
    private readonly string _dbPath;
    private readonly string _tempDir;
    private readonly SqliteDiagnosticsEventSink _sink;
    private static readonly DateTimeOffset Base = new(2026, 7, 15, 12, 0, 0, TimeSpan.Zero);

    public DiagnosticsSinkQueryTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "speculum-diagq-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDir);
        _dbPath = Path.Combine(_tempDir, "speculum.db");

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

        var recorder = new RecordingBus();
        _sink = new SqliteDiagnosticsEventSink(
            _dbPath,
            runtime,
            new Lazy<IDiagnosticsSelfEmitter>(() => new DiagnosticsSelfEmitter(recorder)));
    }

    public void Dispose()
    {
        try { Directory.Delete(_tempDir, recursive: true); }
        catch { /* best-effort */ }
    }

    private async Task SeedSamplesAsync(int count, int intervalSeconds = 30)
    {
        for (var i = 0; i < count; i++)
        {
            await _sink.WriteAsync(new DiagnosticsEvent
            {
                // deterministic, monotonic id so keyset order is stable within a bucket
                Id = $"tele-{i:D5}",
                Utc = Base.AddSeconds(i * intervalSeconds),
                Domain = DiagnosticsDomain.Telemetry,
                Name = "Telemetry.SampleCollected",
                Payload = new { seq = i, host = new { cpuUsage = i } },
            });
        }
    }

    [Fact]
    public async Task Paged_returns_total_and_walks_cursor_without_overlap()
    {
        await SeedSamplesAsync(25);

        var seen = new List<string>();
        string? cursor = null;
        var (curUtc, curId) = SqliteDiagnosticsEventSink.DecodeCursor(cursor);

        var page1 = _sink.QueryEventsPaged(null, null, null, "Telemetry.", 10, curUtc, curId);
        Assert.Equal(25, page1.Total);
        Assert.Equal(10, page1.Items.Count);
        Assert.NotNull(page1.NextCursor);
        seen.AddRange(page1.Items.Select(e => e.Id));

        (curUtc, curId) = SqliteDiagnosticsEventSink.DecodeCursor(page1.NextCursor);
        var page2 = _sink.QueryEventsPaged(null, null, null, "Telemetry.", 10, curUtc, curId);
        Assert.Equal(10, page2.Items.Count);
        seen.AddRange(page2.Items.Select(e => e.Id));

        (curUtc, curId) = SqliteDiagnosticsEventSink.DecodeCursor(page2.NextCursor);
        var page3 = _sink.QueryEventsPaged(null, null, null, "Telemetry.", 10, curUtc, curId);
        Assert.Equal(5, page3.Items.Count);
        Assert.Null(page3.NextCursor);
        seen.AddRange(page3.Items.Select(e => e.Id));

        // No overlap, ascending, all 25 walked exactly once.
        Assert.Equal(25, seen.Distinct().Count());
        Assert.Equal(seen, seen.OrderBy(x => x).ToList());
    }

    [Fact]
    public async Task Paged_respects_until_upper_bound()
    {
        await SeedSamplesAsync(25); // 0..24 @ 30s => spans 12:00:00 .. 12:12:00

        // until = 12:05:00 inclusive => samples at 0,30,...,300s => 11 samples (i=0..10)
        var until = Base.AddSeconds(5 * 60);
        var page = _sink.QueryEventsPaged(null, null, until, "Telemetry.", 100, null, null);

        Assert.Equal(11, page.Total);
        Assert.Equal(11, page.Items.Count);
        Assert.All(page.Items, e => Assert.True(e.Utc <= until));
    }

    [Fact]
    public async Task Bucketed_keeps_last_sample_per_bucket()
    {
        // 12 samples @ 30s across 6 minutes; bucket by 120s => 3 buckets.
        await SeedSamplesAsync(12);

        var bucketed = _sink.QueryEventsBucketed(null, null, null, "Telemetry.", bucketSeconds: 120);

        // 12 samples * 30s = 360s window; ceil into 120s buckets => 3 buckets.
        Assert.Equal(3, bucketed.Count);
        // Ascending by time.
        Assert.Equal(
            bucketed.Select(e => e.Utc).ToList(),
            bucketed.Select(e => e.Utc).OrderBy(x => x).ToList());
        // Each bucket keeps the LAST (latest utc) sample: ids tele-00003, tele-00007, tele-00011.
        Assert.Equal(new[] { "tele-00003", "tele-00007", "tele-00011" }, bucketed.Select(e => e.Id).ToArray());
    }

    [Fact]
    public async Task Bucketed_and_namePrefix_ignores_other_events()
    {
        await SeedSamplesAsync(6);
        await _sink.WriteAsync(new DiagnosticsEvent
        {
            Id = "motor-x",
            Utc = Base.AddSeconds(15),
            Domain = DiagnosticsDomain.MotorLive,
            Name = "Motor.SessionStarted",
            ConnectionId = "conn-1",
        });

        var bucketed = _sink.QueryEventsBucketed(null, null, null, "Telemetry.", bucketSeconds: 3600);
        Assert.Single(bucketed);
        Assert.All(bucketed, e => Assert.StartsWith("Telemetry.", e.Name));
    }

    [Fact]
    public void Cursor_roundtrips_and_tolerates_garbage()
    {
        var encoded = SqliteDiagnosticsEventSink.EncodeCursor("2026-07-15T12:00:00.0000000+00:00", "tele-00007");
        var (utc, id) = SqliteDiagnosticsEventSink.DecodeCursor(encoded);
        Assert.Equal("2026-07-15T12:00:00.0000000+00:00", utc);
        Assert.Equal("tele-00007", id);

        var (gu, gi) = SqliteDiagnosticsEventSink.DecodeCursor("not-base64!!");
        Assert.Null(gu);
        Assert.Null(gi);
    }

    private sealed class RecordingBus : IDiagnosticsEventBus
    {
        public List<DiagnosticsEvent> Events { get; } = [];
        public void Publish(DiagnosticsEvent diagnosticsEvent, bool persist = true)
            => Events.Add(diagnosticsEvent);
    }
}
