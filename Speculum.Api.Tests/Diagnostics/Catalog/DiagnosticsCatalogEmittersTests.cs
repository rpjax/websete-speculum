using Speculum.Api.Config.Application;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Pipeline;
using Speculum.Api.Motor.Live;

namespace Speculum.Api.Tests;

public sealed class DiagnosticsCatalogEmittersTests
{
    [Fact]
    public void Catalog_includes_phase3_critical_event_names_and_emit_types_exist()
    {
        var assembly = typeof(DiagnosticsEventCatalog).Assembly;
        var typeNames = assembly.GetTypes().Select(t => t.FullName).ToHashSet();

        Assert.Contains(typeof(MotorSessionCoordinator).FullName, typeNames);
        Assert.Contains(typeof(MotorSessionDrainHandler).FullName, typeNames);
        Assert.Contains(typeof(SqliteDiagnosticsEventSink).FullName, typeNames);
        Assert.Contains(typeof(MotorSession).FullName, typeNames);
        Assert.NotEmpty(DiagnosticsEventCatalog.All);

        string[] required =
        [
            "Motor.SessionStarted", "Motor.SessionResolved", "Motor.UrlMapped",
            "Motor.SessionStopped", "Motor.NavigateRejected",
            "Motor.DrainStarted", "Motor.DrainCompleted", "Motor.ResizeRequested",
            "Motor.ResizeApplied", "Motor.ResizeRejected", "Motor.ResizeFailed",
            "Motor.InputRejected",
            "Motor.SidecarFaulted", "Diagnostics.StorageOverflow",
            "Diagnostics.ElevateStarted", "Diagnostics.ElevateExpired",
            "Sidecar.DiagProbeRequested", "Sidecar.DiagProbeCompleted",
            "Telemetry.SampleCollected",
        ];
        foreach (var name in required)
            Assert.Contains(name, DiagnosticsEventCatalog.All);
    }

    [Fact]
    public void Telemetry_emit_type_exists_and_descriptor_is_catalogued()
    {
        var assembly = typeof(DiagnosticsEventCatalog).Assembly;
        var typeNames = assembly.GetTypes().Select(t => t.FullName).ToHashSet();

        Assert.Contains(typeof(Speculum.Api.Diagnostics.Telemetry.TelemetryEmitter).FullName, typeNames);
        Assert.Contains(typeof(Speculum.Api.Diagnostics.Telemetry.TelemetrySampleComposer).FullName, typeNames);
        Assert.True(DiagnosticsEventCatalog.TryGet("Telemetry.SampleCollected", out _));
    }
}
