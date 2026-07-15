using Speculum.Api.Diagnostics.Abstractions;

namespace Speculum.Api.Diagnostics.Telemetry;

/// <summary>
/// Emits one composite <c>Telemetry.SampleCollected</c> per tick on the global
/// <c>Telemetry.IntervalSeconds</c> cadence. Sampling pauses (idle poll) whenever the
/// Telemetry domain is disabled; the emitter re-checks the capability before composing.
/// </summary>
public sealed class TelemetrySamplerHostedService : BackgroundService
{
    /// <summary>Poll cadence while Telemetry is disabled — cheap, no collection work.</summary>
    private static readonly TimeSpan IdleInterval = TimeSpan.FromSeconds(10);

    private static readonly TimeSpan MinInterval = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan MaxInterval = TimeSpan.FromMinutes(10);

    private readonly ITelemetryEmitter _emitter;
    private readonly IDiagnosticsRuntime _runtime;
    private readonly ILogger<TelemetrySamplerHostedService> _logger;

    public TelemetrySamplerHostedService(
        ITelemetryEmitter emitter,
        IDiagnosticsRuntime runtime,
        ILogger<TelemetrySamplerHostedService> logger)
    {
        _emitter = emitter;
        _runtime = runtime;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var enabled = _runtime.IsCapabilityEnabled(
                DiagnosticsDomain.Telemetry, DiagnosticsCapability.Metric);

            if (enabled)
            {
                try
                {
                    await _emitter.EmitSampleAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Telemetry sample emit failed.");
                }
            }

            var delay = enabled ? ResolveInterval() : IdleInterval;
            try { await Task.Delay(delay, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private TimeSpan ResolveInterval()
    {
        var seconds = _runtime.GetSnapshot().Options.Telemetry.IntervalSeconds;
        var interval = TimeSpan.FromSeconds(seconds);
        if (interval < MinInterval) return MinInterval;
        if (interval > MaxInterval) return MaxInterval;
        return interval;
    }
}
