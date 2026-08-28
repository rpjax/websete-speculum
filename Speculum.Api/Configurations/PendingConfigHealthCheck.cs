using Microsoft.Extensions.Diagnostics.HealthChecks;
using Speculum.Api.Configurations.Services.Contracts;

namespace Speculum.Api.Configurations;

/// <summary>
/// Ready only when mandatory engine configuration is applied (not pending-config).
/// </summary>
public sealed class PendingConfigHealthCheck : IHealthCheck
{
    private readonly IConfigurationService _configuration;

    public PendingConfigHealthCheck(IConfigurationService configuration)
    {
        _configuration = configuration;
    }

    public Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        if (_configuration.AreMandatorySettingsSatisfied)
            return Task.FromResult(HealthCheckResult.Healthy("Mandatory configuration satisfied."));

        var missing = string.Join(", ", _configuration.MissingRequired);
        return Task.FromResult(
            HealthCheckResult.Unhealthy($"Pending config. Missing: {missing}"));
    }
}
