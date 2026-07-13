using System.Diagnostics;
using Speculum.Api.Diagnostics.Abstractions;

namespace Speculum.Api.Diagnostics.Probes;

public sealed class HostResourceProbe
{
    private DateTimeOffset _lastSampleUtc = DateTimeOffset.MinValue;
    private object _lastSample = new { };

    public object Sample(int minIntervalMs)
    {
        var now = DateTimeOffset.UtcNow;
        if ((now - _lastSampleUtc).TotalMilliseconds < minIntervalMs)
            return _lastSample;

        using var proc = Process.GetCurrentProcess();
        _lastSample = new
        {
            utc = now,
            pid = proc.Id,
            memWorkingSet = proc.WorkingSet64,
            memPrivate = proc.PrivateMemorySize64,
            threadCount = proc.Threads.Count,
            gcHeap = GC.GetTotalMemory(false),
            gcGen0 = GC.CollectionCount(0),
            gcGen1 = GC.CollectionCount(1),
            gcGen2 = GC.CollectionCount(2),
        };
        _lastSampleUtc = now;
        return _lastSample;
    }
}
