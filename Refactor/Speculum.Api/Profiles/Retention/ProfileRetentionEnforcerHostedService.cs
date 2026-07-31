using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Speculum.Api.Profiles.Retention;

/// <summary>
/// Scaffold only: future retention policy enforcer (pair with Cleaner). No purge logic.
/// Real purge = SQLite only (<c>StateJson</c> in <c>browser_profiles</c>; no disk artifacts).
/// </summary>
public sealed class ProfileRetentionEnforcerHostedService : IHostedService
{
    private readonly ILogger<ProfileRetentionEnforcerHostedService> _logger;

    public ProfileRetentionEnforcerHostedService(ILogger<ProfileRetentionEnforcerHostedService> logger)
    {
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            "ProfileRetentionEnforcerHostedService scaffold — purge not enabled (SQLite-only future).");
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
