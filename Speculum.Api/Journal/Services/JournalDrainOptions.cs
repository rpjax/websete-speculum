namespace Speculum.Api.Journal.Services;

/// <summary>
/// Tunables for Journal admission depth, drain worker, and read limits.
/// Bound from configuration section <see cref="SectionName"/>.
/// SQLite path and connection pragmas live in <c>DatabaseOptions</c>.
/// </summary>
public sealed class JournalDrainOptions
{
    public const string SectionName = "Journal";

    public const int DefaultMaxBatchSize = 64;
    public const int DefaultSoftQueueDepth = 10_000;
    public const int DefaultHardQueueDepth = 50_000;
    public const int DefaultMaxQueueDepth = 100_000;
    public const int DefaultShutdownFlushTimeoutSeconds = 5;
    public const int DefaultRecoverAfterSuccessfulBatches = 3;
    public const int DefaultRetryBackoffMilliseconds = 200;
    public const int DefaultMaxPersistAttempts = 5;
    public const int DefaultMaxCrashesInPeriod = 5;
    public const int DefaultCrashPeriodSeconds = 60;
    public const int DefaultCrashRestartBackoffMilliseconds = 1_000;
    public const int DefaultDegradedBestEffortKeep = 0;
    public const int DefaultMaxPayloadBytes = 256 * 1024;
    public const int DefaultQueryLimit = 1_000;
    public const int DefaultMaxReadLimit = 10_000;

    /// <summary>Worker batch size for <c>TakeBatchAsync</c>.</summary>
    public int MaxBatchSize { get; set; } = DefaultMaxBatchSize;

    /// <summary>
    /// When queue depth is at or above this, BestEffort enqueues are dropped.
    /// Guaranteed always attempts admission (until <see cref="MaxQueueDepth"/>).
    /// Use 0 to disable soft shedding.
    /// </summary>
    public int SoftQueueDepth { get; set; } = DefaultSoftQueueDepth;

    /// <summary>
    /// When depth reaches this threshold: drop BestEffort and raise queue-pressure Degraded
    /// (clears when depth falls — independent of persist Degraded).
    /// Must be &gt;= SoftQueueDepth when both are enabled. Use 0 to disable.
    /// </summary>
    public int HardQueueDepth { get; set; } = DefaultHardQueueDepth;

    /// <summary>
    /// Absolute admission ceiling. At or above this depth, Guaranteed is rejected
    /// (admission failure + persist Degraded) and BestEffort is dropped.
    /// Must be &gt;= HardQueueDepth when both are enabled. Use 0 to disable.
    /// </summary>
    public int MaxQueueDepth { get; set; } = DefaultMaxQueueDepth;

    /// <summary>
    /// Max time allowed to TakeBatch+persist remaining queued entries after the drain loop stops.
    /// In-flight persist is awaited without this bound. Must be &gt; 0 (validated on start).
    /// </summary>
    public TimeSpan ShutdownFlushTimeout { get; set; } =
        TimeSpan.FromSeconds(DefaultShutdownFlushTimeoutSeconds);

    /// <summary>
    /// Consecutive successful persist batches (with inserts &gt; 0) required to clear persist Degraded.
    /// </summary>
    public int RecoverAfterSuccessfulBatches { get; set; } = DefaultRecoverAfterSuccessfulBatches;

    public TimeSpan RetryBackoff { get; set; } =
        TimeSpan.FromMilliseconds(DefaultRetryBackoffMilliseconds);

    /// <summary>
    /// Max persist attempts for one batch before the worker drops it.
    /// </summary>
    public int MaxPersistAttempts { get; set; } = DefaultMaxPersistAttempts;

    /// <summary>
    /// Max drain-loop crashes allowed within <see cref="CrashPeriod"/> before the host is stopped.
    /// </summary>
    public int MaxCrashesInPeriod { get; set; } = DefaultMaxCrashesInPeriod;

    /// <summary>Sliding window used with <see cref="MaxCrashesInPeriod"/>.</summary>
    public TimeSpan CrashPeriod { get; set; } = TimeSpan.FromSeconds(DefaultCrashPeriodSeconds);

    /// <summary>Delay before restarting the drain loop after a crash.</summary>
    public TimeSpan CrashRestartBackoff { get; set; } =
        TimeSpan.FromMilliseconds(DefaultCrashRestartBackoffMilliseconds);

    /// <summary>
    /// Under Degraded, keep at most this many BestEffort entries per batch (0 = drop all).
    /// </summary>
    public int DegradedBestEffortKeep { get; set; } = DefaultDegradedBestEffortKeep;

    /// <summary>Maximum UTF-8 payload size accepted by the writer (bytes).</summary>
    public int MaxPayloadBytes { get; set; } = DefaultMaxPayloadBytes;

    /// <summary>Default <c>JournalQuery.Limit</c> when the caller omits Limit.</summary>
    public int DefaultReadLimit { get; set; } = DefaultQueryLimit;

    /// <summary>Hard ceiling for <c>JournalQuery.Limit</c>.</summary>
    public int MaxReadLimit { get; set; } = DefaultMaxReadLimit;
}
