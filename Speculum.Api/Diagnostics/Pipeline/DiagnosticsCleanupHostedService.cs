using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;

namespace Speculum.Api.Diagnostics.Pipeline;

public sealed class DiagnosticsCleanupHostedService : BackgroundService
{
    private readonly SqliteDiagnosticsEventSink _sink;
    private readonly IDiagnosticsRuntime _runtime;
    private readonly IDiagnosticsEventBus _bus;
    private readonly ILogger<DiagnosticsCleanupHostedService> _logger;

    public DiagnosticsCleanupHostedService(
        SqliteDiagnosticsEventSink sink,
        IDiagnosticsRuntime runtime,
        IDiagnosticsEventBus bus,
        ILogger<DiagnosticsCleanupHostedService> logger)
    {
        _sink = sink;
        _runtime = runtime;
        _bus = bus;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (_runtime is DiagnosticsRuntime concreteRuntime
                    && concreteRuntime.TryConsumeElevateExpired())
                {
                    _bus.Publish(new DiagnosticsEvent
                    {
                        Domain = DiagnosticsDomain.DiagnosticsSelf,
                        Name = "Diagnostics.ElevateExpired",
                        Payload = new { reason = "ttl" },
                    });
                }

                var options = _runtime.GetSnapshot().Options;
                var purged = _sink.PurgeExpired(options);
                if (purged > 0)
                {
                    _bus.Publish(new DiagnosticsEvent
                    {
                        Domain = DiagnosticsDomain.DiagnosticsSelf,
                        Name = "Diagnostics.CleanupPurged",
                        Payload = new { purged },
                    });
                }

                if (_runtime.IsDegraded)
                {
                    // Recover only when the cleanup cycle itself succeeds and drops are calm.
                    _runtime.SetDegraded(false);
                    _bus.Publish(new DiagnosticsEvent
                    {
                        Domain = DiagnosticsDomain.DiagnosticsSelf,
                        Name = "Diagnostics.Recovered",
                        Payload = new { reason = "cleanup_cycle" },
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Diagnostics cleanup failed.");
            }

            await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken);
        }
    }
}
