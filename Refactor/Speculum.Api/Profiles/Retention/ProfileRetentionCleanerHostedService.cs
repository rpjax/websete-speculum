using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Speculum.Api.Profiles.Retention;

/// <summary>
/// Scaffold only: future inactive-profile purge (SQLite <c>browser_profiles</c> rows via
/// <c>IProfileRepository.Delete</c> / <c>UpdatedAt</c> + <c>InactiveRetentionPeriod</c>).
/// Does not read retention config or delete rows.
/// </summary>
public sealed class ProfileRetentionCleanerHostedService : IHostedService
{
    private readonly ILogger<ProfileRetentionCleanerHostedService> _logger;

    public ProfileRetentionCleanerHostedService(ILogger<ProfileRetentionCleanerHostedService> logger)
    {
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            "ProfileRetentionCleanerHostedService scaffold — purge not enabled (SQLite-only future).");
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
