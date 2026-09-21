using Speculum.Supervisor.Wire;

namespace Speculum.Lab.Upstream;

/// <summary>Fachada: decode Virtual vive em Speculum.Supervisor.Wire.CatalogTelemetry.</summary>
public static class GeckoCatalogTelemetry
{
    public static object? TryDecode(uint contextId, ReadOnlySpan<byte> payload) =>
        CatalogTelemetry.TryDecode(contextId, payload);
}
