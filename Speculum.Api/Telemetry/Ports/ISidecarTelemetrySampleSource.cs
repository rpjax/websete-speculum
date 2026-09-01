using Speculum.Api.Telemetry.Models;

namespace Speculum.Api.Telemetry.Ports;

public interface ISidecarTelemetrySampleSource
{
    Task<SidecarTelemetrySample?> CollectAsync(SidecarTelemetryRequest request, CancellationToken ct);
}
