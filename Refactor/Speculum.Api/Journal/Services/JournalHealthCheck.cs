using Microsoft.Extensions.Diagnostics.HealthChecks;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.Journal.Services;

/// <summary>
/// Reports Journal Healthy/Degraded and queue depth for host health checks.
/// </summary>
public sealed class JournalHealthCheck : IHealthCheck
{
    private readonly IJournalHealth _health;
    private readonly IJournalQueue _queue;
    private readonly JournalDrainMetrics _metrics;

    public JournalHealthCheck(
        IJournalHealth health,
        IJournalQueue queue,
        JournalDrainMetrics metrics)
    {
        _health = health ?? throw new ArgumentNullException(nameof(health));
        _queue = queue ?? throw new ArgumentNullException(nameof(queue));
        _metrics = metrics ?? throw new ArgumentNullException(nameof(metrics));
    }

    public Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        var data = new Dictionary<string, object>
        {
            ["queueDepth"] = _queue.Count,
            ["persisted"] = _metrics.Persisted,
            ["droppedOnEnqueue"] = _metrics.DroppedOnEnqueue,
            ["persistFailures"] = _metrics.PersistFailures,
            ["guaranteedAdmissionFailures"] = _metrics.GuaranteedAdmissionFailures,
            ["persistDegraded"] = _health.IsPersistDegraded,
            ["queuePressure"] = _health.IsQueuePressureActive,
            ["drainRunning"] = _health.IsDrainRunning,
            ["admissionOpen"] = _health.IsAdmissionOpen,
            ["shutdownAbandoned"] = _metrics.ShutdownAbandoned,
            ["persistAbandoned"] = _metrics.PersistAbandoned,
            ["loopCrashes"] = _metrics.LoopCrashes,
        };

        if (!_health.IsDrainRunning)
        {
            return Task.FromResult(HealthCheckResult.Unhealthy(
                "Journal drain is not running.",
                data: data));
        }

        if (_health.State == JournalHealthState.Healthy)
            return Task.FromResult(HealthCheckResult.Healthy("Journal is Healthy.", data));

        var reason = _health.LastError ?? "Journal is Degraded.";
        return Task.FromResult(HealthCheckResult.Degraded(reason, data: data));
    }
}
