using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Database;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.Profiles.Retention;

/// <summary>
/// Budget-driven purge. Seizes the Cleaner gate and climbs the degradation ladder.
/// Nobody stops the Enforcer.
/// </summary>
public sealed class ProfileRetentionEnforcerHostedService : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromMinutes(5);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IRetentionWorkGate _gate;
    private readonly IRetentionPurgeExecutor _executor;
    private readonly IOptions<DatabaseOptions> _database;
    private readonly IHostEnvironment _environment;
    private readonly ILogger<ProfileRetentionEnforcerHostedService> _logger;

    public ProfileRetentionEnforcerHostedService(
        IServiceScopeFactory scopeFactory,
        IRetentionWorkGate gate,
        IRetentionPurgeExecutor executor,
        IOptions<DatabaseOptions> database,
        IHostEnvironment environment,
        ILogger<ProfileRetentionEnforcerHostedService> logger)
    {
        _scopeFactory = scopeFactory ?? throw new ArgumentNullException(nameof(scopeFactory));
        _gate = gate ?? throw new ArgumentNullException(nameof(gate));
        _executor = executor ?? throw new ArgumentNullException(nameof(executor));
        _database = database ?? throw new ArgumentNullException(nameof(database));
        _environment = environment ?? throw new ArgumentNullException(nameof(environment));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ProfileRetentionEnforcerHostedService started (interval {Interval})", Interval);
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

            try
            {
                await TickAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "Retention Enforcer tick failed");
            }
        }
    }

    private async Task TickAsync(CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var configuration = sp.GetRequiredService<IConfigurationService>().GetCurrent();
        var budget = configuration.ResourceManagement.Storage.BudgetBytes;
        var journalEstimate = await sp.GetRequiredService<IJournalRepository>()
            .EstimateStoredBytesAsync(ct)
            .ConfigureAwait(false);
        var db = sp.GetRequiredService<SpeculumDbContext>();
        var used = await RetentionStorageUsage.MeasureBytesAsync(
                db,
                _database,
                _environment,
                journalEstimate,
                ct)
            .ConfigureAwait(false);

        var level = RetentionDegradation.FromUsage(used, budget);
        if (level == RetentionDegradationLevel.None)
            return;

        _logger.LogInformation(
            "Retention Enforcer degraded level {Level} (used≈{Used} budget={Budget})",
            level,
            used,
            budget);

        _gate.EnterEnforcer();
        try
        {
            await _executor.RunUnderPressureAsync(level, ct).ConfigureAwait(false);
        }
        finally
        {
            _gate.ExitEnforcer();
        }
    }
}
