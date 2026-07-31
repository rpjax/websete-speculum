using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Speculum.Api.Profiles.Retention;

/// <summary>
/// Linear expired-only purge. Yields when Enforcer holds <see cref="IRetentionWorkGate"/>.
/// Never disabled — cadence is a technical default.
/// </summary>
public sealed class ProfileRetentionCleanerHostedService : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    private readonly IRetentionWorkGate _gate;
    private readonly IRetentionPurgeExecutor _executor;
    private readonly ILogger<ProfileRetentionCleanerHostedService> _logger;

    public ProfileRetentionCleanerHostedService(
        IRetentionWorkGate gate,
        IRetentionPurgeExecutor executor,
        ILogger<ProfileRetentionCleanerHostedService> logger)
    {
        _gate = gate ?? throw new ArgumentNullException(nameof(gate));
        _executor = executor ?? throw new ArgumentNullException(nameof(executor));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ProfileRetentionCleanerHostedService started (interval {Interval})", Interval);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(Interval, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            if (!_gate.TryEnterCleaner())
            {
                _logger.LogDebug("Retention Cleaner skipped — Enforcer holds gate");
                continue;
            }

            try
            {
                await _executor.RunExpiredOnlyAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "Retention Cleaner tick failed");
            }
            finally
            {
                _gate.ExitCleaner();
            }
        }
    }
}
