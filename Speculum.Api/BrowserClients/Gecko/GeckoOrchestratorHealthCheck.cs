using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Sidecar;

namespace Speculum.Api.BrowserClients.Gecko;

/// <summary>Ready when the Gecko orchestrator answers /ready. Chromium engine skips this check.</summary>
public sealed class GeckoOrchestratorHealthCheck(
    IHttpClientFactory httpFactory,
    IOptions<SidecarOptions> options) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        if (options.Value.Engine != SidecarEngine.Gecko)
        {
            return HealthCheckResult.Healthy("Chromium engine — orchestrator check skipped.");
        }

        try
        {
            var client = httpFactory.CreateClient(GeckoBrowserClient.HttpClientName);
            using var response = await client.GetAsync("ready", cancellationToken).ConfigureAwait(false);
            if (response.IsSuccessStatusCode)
            {
                return HealthCheckResult.Healthy("Gecko orchestrator ready.");
            }

            return HealthCheckResult.Unhealthy($"Orchestrator /ready returned {(int)response.StatusCode}.");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("Orchestrator unreachable.", ex);
        }
    }
}
