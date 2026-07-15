using Speculum.Api.Diagnostics.Abstractions;

namespace Speculum.Api.Tests;

public sealed class DiagnosticsCatalogTests
{
    [Fact]
    public void All_is_non_empty_and_contains_expected_events()
    {
        Assert.NotEmpty(DiagnosticsEventCatalog.All);
        Assert.Contains("Motor.SessionStarted", DiagnosticsEventCatalog.All);
        Assert.Contains("Motor.SessionResolved", DiagnosticsEventCatalog.All);
        Assert.Contains("Motor.UrlMapped", DiagnosticsEventCatalog.All);
        Assert.Contains("Diagnostics.Degraded", DiagnosticsEventCatalog.All);
        Assert.Contains("Telemetry.SampleCollected", DiagnosticsEventCatalog.All);
    }

    [Fact]
    public void Telemetry_sample_is_a_persisted_telemetry_metric()
    {
        Assert.True(DiagnosticsEventCatalog.TryGet("Telemetry.SampleCollected", out var descriptor));
        Assert.Equal(DiagnosticsDomain.Telemetry, descriptor.Domain);
        Assert.Equal(DiagnosticsCapability.Metric, descriptor.Capability);
        Assert.True(descriptor.Persist);
    }
}
