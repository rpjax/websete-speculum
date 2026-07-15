using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Emitters;

namespace Speculum.Api.Diagnostics.Pipeline;

public sealed class DiagnosticsCleanupHostedService : BackgroundService
{
    /// <summary>Normal purge / elevate-expiry cadence.</summary>
    private static readonly TimeSpan HealthyInterval = TimeSpan.FromSeconds(30);

    /// <summary>
    /// While the publish circuit is open, poll quickly so BrowserQuery probes are not
    /// stuck at Metrics for an entire MotorAssert suite (or ops incident window).
    /// </summary>
    private static readonly TimeSpan DegradedInterval = TimeSpan.FromSeconds(5);

    private readonly SqliteDiagnosticsEventSink _sink;
    private readonly IDiagnosticsRuntime _runtime;
    private readonly IDiagnosticsSelfEmitter _self;
    private readonly ILogger<DiagnosticsCleanupHostedService> _logger;

    public DiagnosticsCleanupHostedService(
        SqliteDiagnosticsEventSink sink,
        IDiagnosticsRuntime runtime,
        IDiagnosticsSelfEmitter self,
        ILogger<DiagnosticsCleanupHostedService> logger)
    {
        _sink = sink;
        _runtime = runtime;
        _self = self;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var enteredDegraded = _runtime.IsDegraded;
            try
            {
                if (_runtime is DiagnosticsRuntime concreteRuntime
                    && concreteRuntime.TryConsumeElevateExpired())
                {
                    _self.ElevateExpired("ttl");
                }

                var options = _runtime.GetSnapshot().Options;
                var purged = _sink.PurgeExpired(options);
                if (purged > 0)
                    _self.CleanupPurged(purged);

                if (_runtime.IsDegraded)
                {
                    _runtime.SetDegraded(false);
                    _self.Recovered("cleanup_cycle");
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Diagnostics cleanup failed.");
            }

            var delay = enteredDegraded || _runtime.IsDegraded
                ? DegradedInterval
                : HealthyInterval;
            await Task.Delay(delay, stoppingToken);
        }
    }
}
