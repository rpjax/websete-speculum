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
            "Motor.SidecarFaulted", "Diagnostics.StorageOverflow",
            "Diagnostics.ElevateStarted", "Diagnostics.ElevateExpired",
            "Sidecar.DiagProbeRequested", "Sidecar.DiagProbeCompleted",
        ];
        foreach (var name in required)
            Assert.Contains(name, DiagnosticsEventCatalog.All);
    }
}
