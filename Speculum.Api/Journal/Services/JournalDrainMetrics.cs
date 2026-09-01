using System.Diagnostics;
using System.Diagnostics.Metrics;

namespace Speculum.Api.Journal.Services;

/// <summary>
/// Lock-free counters for Journal admission and drain, mirrored to <see cref="System.Diagnostics.Metrics"/>.
/// Instruments are static (one set per process); instance fields support tests and health checks.
/// </summary>
public sealed class JournalDrainMetrics
{
    public const string MeterName = "Speculum.Journal";
    public static readonly ActivitySource ActivitySource = new("Speculum.Journal");

    private static readonly Meter Meter = new(MeterName, "1.0.0");
    private static readonly Counter<long> EnqueuedCounter =
        Meter.CreateCounter<long>("journal.enqueued", description: "Facts accepted into the admission queue.");
    private static readonly Counter<long> DroppedOnEnqueueCounter =
        Meter.CreateCounter<long>("journal.dropped_on_enqueue", description: "BestEffort facts shed at admission.");
    private static readonly Counter<long> DroppedByPolicyCounter =
        Meter.CreateCounter<long>("journal.dropped_by_policy", description: "Facts dropped by drain policy.");
    private static readonly Counter<long> PersistedCounter =
        Meter.CreateCounter<long>("journal.persisted", description: "Newly inserted Journal rows.");
    private static readonly Counter<long> BatchesCounter =
        Meter.CreateCounter<long>("journal.batches", description: "Persist batch attempts that completed without throw.");
    private static readonly Counter<long> PersistFailuresCounter =
        Meter.CreateCounter<long>("journal.persist_failures", description: "Persist batch failures.");
    private static readonly Counter<long> GuaranteedAdmissionFailuresCounter =
        Meter.CreateCounter<long>("journal.guaranteed_admission_failures", description: "Guaranteed facts rejected at admission.");
    private static readonly Counter<long> DegradedEnterCounter =
        Meter.CreateCounter<long>("journal.degraded_enter", description: "Transitions into Degraded.");
    private static readonly Counter<long> DegradedRecoverCounter =
        Meter.CreateCounter<long>("journal.degraded_recover", description: "Transitions out of Degraded.");
    private static readonly Counter<long> HardDepthPressureCounter =
        Meter.CreateCounter<long>("journal.hard_depth_pressure", description: "HardQueueDepth rising-edge events.");
    private static readonly Counter<long> LoopCrashCounter =
        Meter.CreateCounter<long>("journal.loop_crashes", description: "Journal drain loop crashes (supervised restart).");
    private static readonly Counter<long> ShutdownAbandonedCounter =
        Meter.CreateCounter<long>("journal.shutdown_abandoned", description: "Queued entries abandoned after shutdown flush timeout.");
    private static readonly Counter<long> PersistAbandonedCounter =
        Meter.CreateCounter<long>("journal.persist_abandoned", description: "Entries dropped after MaxPersistAttempts.");
    private static readonly Counter<long> SkippedDisabledCounter =
        Meter.CreateCounter<long>("journal.skipped_disabled", description: "Append skipped because fact type disabled.");
    private static readonly Counter<long> SkippedUnregisteredCounter =
        Meter.CreateCounter<long>("journal.skipped_unregistered", description: "Append skipped because type unregistered.");
    private static readonly Histogram<double> BatchDurationMs =
        Meter.CreateHistogram<double>("journal.batch_duration_ms", unit: "ms", description: "Persist batch duration.");

    private static int _observedQueueDepth;
    private static int _gaugeRegistered;

    private long _enqueued;
    private long _droppedOnEnqueue;
    private long _droppedByPolicy;
    private long _persisted;
    private long _batches;
    private long _persistFailures;
    private long _guaranteedAdmissionFailures;
    private long _degradedEnter;
    private long _degradedRecover;
    private long _hardDepthPressure;
    private long _loopCrashes;
    private long _shutdownAbandoned;
    private long _persistAbandoned;
    private long _skippedDisabled;
    private long _skippedUnregistered;
    private long _lastBatchDurationMs;
    private int _queueDepth;

    public JournalDrainMetrics()
    {
        if (Interlocked.Exchange(ref _gaugeRegistered, 1) == 0)
        {
            Meter.CreateObservableGauge(
                "journal.queue_depth",
                () => Volatile.Read(ref _observedQueueDepth),
                description: "Approximate in-process admission queue depth.");
        }
    }

    public long Enqueued => Interlocked.Read(ref _enqueued);
    public long DroppedOnEnqueue => Interlocked.Read(ref _droppedOnEnqueue);
    public long DroppedByPolicy => Interlocked.Read(ref _droppedByPolicy);
    public long Persisted => Interlocked.Read(ref _persisted);
    public long Batches => Interlocked.Read(ref _batches);
    public long PersistFailures => Interlocked.Read(ref _persistFailures);
    public long GuaranteedAdmissionFailures => Interlocked.Read(ref _guaranteedAdmissionFailures);
    public long DegradedEnter => Interlocked.Read(ref _degradedEnter);
    public long DegradedRecover => Interlocked.Read(ref _degradedRecover);
    public long HardDepthPressure => Interlocked.Read(ref _hardDepthPressure);
    public long LoopCrashes => Interlocked.Read(ref _loopCrashes);
    public long ShutdownAbandoned => Interlocked.Read(ref _shutdownAbandoned);
    public long PersistAbandoned => Interlocked.Read(ref _persistAbandoned);
    public long SkippedDisabled => Interlocked.Read(ref _skippedDisabled);
    public long SkippedUnregistered => Interlocked.Read(ref _skippedUnregistered);
    public long LastBatchDurationMs => Interlocked.Read(ref _lastBatchDurationMs);
    public int QueueDepth => Volatile.Read(ref _queueDepth);

    public void RecordEnqueue()
    {
        Interlocked.Increment(ref _enqueued);
        EnqueuedCounter.Add(1);
    }

    public void RecordDroppedOnEnqueue(int count = 1)
    {
        if (count <= 0)
            return;
        Interlocked.Add(ref _droppedOnEnqueue, count);
        DroppedOnEnqueueCounter.Add(count);
    }

    public void RecordDroppedByPolicy(int count)
    {
        if (count <= 0)
            return;
        Interlocked.Add(ref _droppedByPolicy, count);
        DroppedByPolicyCounter.Add(count);
    }

    public void RecordPersist(int count, long durationMs)
    {
        if (count > 0)
        {
            Interlocked.Add(ref _persisted, count);
            PersistedCounter.Add(count);
        }

        Interlocked.Increment(ref _batches);
        BatchesCounter.Add(1);
        Interlocked.Exchange(ref _lastBatchDurationMs, durationMs);
        BatchDurationMs.Record(durationMs);
    }

    /// <summary>
    /// Successful drain attempt that inserted nothing (idempotent skip of existing Ids).
    /// Counts as a batch for latency, not as health recovery.
    /// </summary>
    public void RecordPersistBatch(long durationMs)
    {
        Interlocked.Increment(ref _batches);
        BatchesCounter.Add(1);
        Interlocked.Exchange(ref _lastBatchDurationMs, durationMs);
        BatchDurationMs.Record(durationMs);
    }

    public void RecordPersistFailure()
    {
        Interlocked.Increment(ref _persistFailures);
        PersistFailuresCounter.Add(1);
    }

    public void RecordGuaranteedAdmissionFailure()
    {
        Interlocked.Increment(ref _guaranteedAdmissionFailures);
        GuaranteedAdmissionFailuresCounter.Add(1);
    }

    public void RecordDegradedEnter()
    {
        Interlocked.Increment(ref _degradedEnter);
        DegradedEnterCounter.Add(1);
    }

    public void RecordDegradedRecover()
    {
        Interlocked.Increment(ref _degradedRecover);
        DegradedRecoverCounter.Add(1);
    }

    public void RecordHardDepthPressure()
    {
        Interlocked.Increment(ref _hardDepthPressure);
        HardDepthPressureCounter.Add(1);
    }

    public void RecordLoopCrash()
    {
        Interlocked.Increment(ref _loopCrashes);
        LoopCrashCounter.Add(1);
    }

    public void RecordShutdownAbandoned(int count)
    {
        if (count <= 0)
            return;
        Interlocked.Add(ref _shutdownAbandoned, count);
        ShutdownAbandonedCounter.Add(count);
    }

    public void RecordPersistAbandoned(int count)
    {
        if (count <= 0)
            return;
        Interlocked.Add(ref _persistAbandoned, count);
        PersistAbandonedCounter.Add(count);
    }

    public void RecordSkippedDisabled()
    {
        Interlocked.Increment(ref _skippedDisabled);
        SkippedDisabledCounter.Add(1);
    }

    public void RecordSkippedUnregistered()
    {
        Interlocked.Increment(ref _skippedUnregistered);
        SkippedUnregisteredCounter.Add(1);
    }

    public void SampleQueueDepth(int depth)
    {
        Volatile.Write(ref _queueDepth, depth);
        Volatile.Write(ref _observedQueueDepth, depth);
    }
}
