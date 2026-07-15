using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Emitters;
using Speculum.Api.Diagnostics.Pipeline;

namespace Speculum.Api.Tests;

/// <summary>
/// Drives one real cleanup cycle of the <see cref="DiagnosticsCleanupHostedService"/> and
/// asserts the self-emitted evidence (purge / elevate-expiry / auto-recover). The cycle body
/// runs synchronously before the first <c>Task.Delay</c>, so StartAsync guarantees it executed.
/// </summary>
public sealed class DiagnosticsCleanupHostedServiceTests : IDisposable
{
    private readonly string _tempDir;
    private readonly string _dbPath;

    public DiagnosticsCleanupHostedServiceTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "speculum-cleanup-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDir);
        _dbPath = Path.Combine(_tempDir, "speculum.db");
    }

    public void Dispose()
    {
        try { Directory.Delete(_tempDir, recursive: true); }
        catch { /* best-effort */ }
    }

    [Fact]
    public async Task Cycle_purges_expired_events_and_emits_CleanupPurged()
    {
        var runtime = DevelopmentRuntime();
        var self = new RecordingSelfEmitter();
        var sink = BuildSink(runtime, self);

        // Seed an event well beyond any TTL so PurgeExpired removes exactly it.
        await sink.WriteAsync(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.MotorLive,
            Name = "Motor.SessionStarted",
            ConnectionId = "conn-old",
            Utc = DateTimeOffset.UtcNow.AddHours(-1000),
        });

        await RunOneCycleAsync(sink, runtime, self);

        Assert.Equal(1, self.CleanupPurgedCalls);
        Assert.Equal(1, self.LastPurged);
    }

    [Fact]
    public async Task Cycle_without_expired_events_does_not_emit_CleanupPurged()
    {
        var runtime = DevelopmentRuntime();
        var self = new RecordingSelfEmitter();
        var sink = BuildSink(runtime, self);

        await sink.WriteAsync(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.MotorLive,
            Name = "Motor.SessionStarted",
            ConnectionId = "conn-fresh",
            Utc = DateTimeOffset.UtcNow,
        });

        await RunOneCycleAsync(sink, runtime, self);

        Assert.Equal(0, self.CleanupPurgedCalls);
    }

    [Fact]
    public async Task Cycle_consumes_expired_elevate_and_emits_ElevateExpired_once()
    {
        var runtime = DevelopmentRuntime();
        var self = new RecordingSelfEmitter();
        var sink = BuildSink(runtime, self);

        // Already-past expiry so the runtime latches the expired-pending flag deterministically.
        runtime.SetElevate(TimeSpan.FromMilliseconds(-1));

        await RunOneCycleAsync(sink, runtime, self);

        Assert.Equal(1, self.ElevateExpiredCalls);
        Assert.Equal("ttl", self.LastElevateExpiredReason);
        // Flag was consumed — a subsequent poll finds nothing pending.
        Assert.False(runtime.TryConsumeElevateExpired());
    }

    [Fact]
    public async Task Cycle_auto_recovers_from_degraded_and_emits_Recovered()
    {
        var runtime = DevelopmentRuntime();
        var self = new RecordingSelfEmitter();
        var sink = BuildSink(runtime, self);

        runtime.SetDegraded(true);

        await RunOneCycleAsync(sink, runtime, self);

        Assert.False(runtime.IsDegraded);
        Assert.Equal(1, self.RecoveredCalls);
        Assert.Equal("cleanup_cycle", self.LastRecoveredReason);
    }

    private static async Task RunOneCycleAsync(
        SqliteDiagnosticsEventSink sink, IDiagnosticsRuntime runtime, IDiagnosticsSelfEmitter self)
    {
        var service = new DiagnosticsCleanupHostedService(
            sink, runtime, self, NullLogger<DiagnosticsCleanupHostedService>.Instance);

        await service.StartAsync(CancellationToken.None);

        // The background loop runs its cycle asynchronously; PurgeExpired stamps LastCleanupUtc
        // every cycle, so wait for that before stopping to guarantee the full body executed.
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (runtime.GetSnapshot().LastCleanupUtc is null && DateTime.UtcNow < deadline)
            await Task.Delay(10);

        await service.StopAsync(CancellationToken.None);
    }

    private static DiagnosticsRuntime DevelopmentRuntime()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(DiagnosticsSeedProfiles.Development());
        return runtime;
    }

    private SqliteDiagnosticsEventSink BuildSink(
        IDiagnosticsRuntime runtime, IDiagnosticsSelfEmitter self)
        => new(_dbPath, runtime, new Lazy<IDiagnosticsSelfEmitter>(() => self));

    private sealed class RecordingSelfEmitter : IDiagnosticsSelfEmitter
    {
        public int CleanupPurgedCalls { get; private set; }
        public int LastPurged { get; private set; }
        public int ElevateExpiredCalls { get; private set; }
        public string? LastElevateExpiredReason { get; private set; }
        public int RecoveredCalls { get; private set; }
        public string? LastRecoveredReason { get; private set; }

        public void CleanupPurged(int purged)
        {
            CleanupPurgedCalls++;
            LastPurged = purged;
        }

        public void ElevateExpired(string reason, string? actorIp = null)
        {
            ElevateExpiredCalls++;
            LastElevateExpiredReason = reason;
        }

        public void Recovered(string reason, string? actorIp = null)
        {
            RecoveredCalls++;
            LastRecoveredReason = reason;
        }

        public void ConfigApplied(bool enabled, string profile) { }
        public void ElevateStarted(int minutes, string actorIp) { }
        public void StorageOverflow(long maxBytes, int dropped, string overflow) { }
        public void Degraded(string reason) { }
    }
}
