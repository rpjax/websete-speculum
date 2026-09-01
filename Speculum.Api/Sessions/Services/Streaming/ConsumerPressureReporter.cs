namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// Snapshot of consumer-side PageProjection frame queue pressure (M3).
/// .NET measures; motor reacts via Control <c>consumer_pressure</c>.
/// </summary>
public readonly record struct ConsumerPressureSnapshot(
    uint QueuedFrames,
    ulong QueuedBytes,
    ulong OldestQueuedMs,
    bool Draining);

/// <summary>
/// Rate-limits <see cref="ConsumerPressureSnapshot"/> reports toward the sidecar Control stream.
/// </summary>
internal sealed class ConsumerPressureReporter
{
    public const int MinReportIntervalMs = 250;

    private readonly object _gate = new();
    private long _lastReportUnixMs;
    private ConsumerPressureSnapshot _lastSnapshot;

    public bool ShouldReport(in ConsumerPressureSnapshot snapshot, long nowUnixMs)
    {
        lock (_gate)
        {
            if (snapshot.QueuedFrames == 0 && !_lastSnapshot.Draining && !snapshot.Draining)
            {
                _lastSnapshot = snapshot;
                return false;
            }

            var elapsed = nowUnixMs - _lastReportUnixMs;
            var pressureIncreased = snapshot.QueuedFrames > _lastSnapshot.QueuedFrames;
            var drainingChanged = snapshot.Draining != _lastSnapshot.Draining;
            if (elapsed < MinReportIntervalMs && !pressureIncreased && !drainingChanged)
            {
                return false;
            }

            _lastReportUnixMs = nowUnixMs;
            _lastSnapshot = snapshot;
            return true;
        }
    }
}
