using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Pipeline;
using Speculum.Api.Motor.Diagnostics;

namespace Speculum.Api.Tests;

internal static class TestMotorDiagnostics
{
    /// <summary>
    /// Wraps a fake transport bus in a real Motor producer factory (Development profile) so tests
    /// exercise the producer → transport path while still asserting on emitted events.
    /// </summary>
    public static IMotorEventsFactory Factory(IDiagnosticsEventBus bus)
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(DiagnosticsSeedProfiles.Development());
        var spans = new SpanTracker(new Lazy<IDiagnosticsEventBus>(() => bus));
        return new MotorEventsFactory(bus, runtime, spans);
    }

    /// <summary>A single context-bound handle, for tests that build a <c>MotorSession</c> directly.</summary>
    public static IMotorEvents Events(IDiagnosticsEventBus bus)
        => Factory(bus).Begin("conn-test", "corr-test");
}
