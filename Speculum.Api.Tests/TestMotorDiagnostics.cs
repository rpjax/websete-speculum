using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Pipeline;
using Speculum.Api.Motor.Diagnostics;

namespace Speculum.Api.Tests;

internal static class TestMotorDiagnostics
{
    /// <summary>
    /// Wraps a fake transport bus in a real Motor emitter (Development profile) so tests
    /// exercise the emitter → transport path while still asserting on emitted events.
    /// </summary>
    public static IMotorDiagnosticsEmitter Emitter(IDiagnosticsEventBus bus)
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(DiagnosticsSeedProfiles.Development());
        return new MotorDiagnosticsEmitter(bus, runtime);
    }
}
