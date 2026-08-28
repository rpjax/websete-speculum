namespace Speculum.Api.Telemetry.Ports;

public interface IProfileTelemetrySampleSource
{
    Task<(int Total, long? StorageBytes)> CollectAsync(bool includeStorageBytes, CancellationToken ct);
}
