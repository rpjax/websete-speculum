using Speculum.Api.BrowserClients;
using Speculum.Api.Telemetry.Models;
using Speculum.Api.Telemetry.Ports;

namespace Speculum.Api.BrowserClients.Telemetry;

/// <summary>Adapter: browser client CollectTelemetry → Telemetry sampling port.</summary>
public sealed class SidecarTelemetrySampleSource(IBrowserClient browser) : ISidecarTelemetrySampleSource
{
    public async Task<SidecarTelemetrySample?> CollectAsync(
        SidecarTelemetryRequest request,
        CancellationToken ct)
    {
        var result = await browser.CollectTelemetryAsync(request, ct).ConfigureAwait(false);
        return result.IsSuccess ? result.Value : null;
    }
}
