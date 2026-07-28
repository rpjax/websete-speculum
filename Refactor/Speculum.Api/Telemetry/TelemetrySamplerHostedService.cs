using Speculum.Api.Configurations.Services.Contracts;

namespace Speculum.Api.Telemetry;

public sealed class TelemetrySamplerHostedService(
    ITelemetryEmitter emitter,
    IConfigurationService configuration,
    ILogger<TelemetrySamplerHostedService> logger) : BackgroundService
{
    internal static readonly TimeSpan IdleInterval = TimeSpan.FromSeconds(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var options = configuration.GetCurrent().Telemetry;
            if (options.IsEnabled)
            {
                try
                {
                    await emitter.EmitAsync(stoppingToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Telemetry sample collection failed.");
                }
            }

            var delay = ResolveDelay(options);
            try
            {
                await Task.Delay(delay, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    public static TimeSpan ResolveDelay(Configurations.Models.Telemetry.TelemetryConfiguration options)
        => options.IsEnabled
            ? TimeSpan.FromSeconds(
                Configurations.Models.Telemetry.TelemetryConfiguration.ClampIntervalSeconds(
                    options.IntervalSeconds))
            : IdleInterval;
}
