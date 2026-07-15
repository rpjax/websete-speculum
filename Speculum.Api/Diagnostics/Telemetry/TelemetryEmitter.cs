using Speculum.Api.Diagnostics.Abstractions;

namespace Speculum.Api.Diagnostics.Telemetry;

/// <summary>
/// Domain emitter for <c>Telemetry.SampleCollected</c>. Checks the Telemetry capability
/// (i.e. <c>Telemetry.Enabled</c>) before composing so a disabled domain does zero collection
/// work; the transport gates independently on the catalog descriptor.
/// </summary>
public interface ITelemetryEmitter
{
    Task EmitSampleAsync(CancellationToken ct = default);
}

public sealed class TelemetryEmitter : ITelemetryEmitter
{
    private readonly IDiagnosticsRuntime _runtime;
    private readonly ITelemetrySampleComposer _composer;
    private readonly IDiagnosticsEventBus _bus;

    public TelemetryEmitter(
        IDiagnosticsRuntime runtime,
        ITelemetrySampleComposer composer,
        IDiagnosticsEventBus bus)
    {
        _runtime = runtime;
        _composer = composer;
        _bus = bus;
    }

    public async Task EmitSampleAsync(CancellationToken ct = default)
    {
        if (!_runtime.IsCapabilityEnabled(DiagnosticsDomain.Telemetry, DiagnosticsCapability.Metric))
            return;

        var telemetry = _runtime.GetSnapshot().Options.Telemetry;
        var sample = await _composer.ComposeAsync(telemetry, ct);

        _bus.Publish(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.Telemetry,
            Name = "Telemetry.SampleCollected",
            Severity = DiagnosticsSeverity.Information,
            Payload = sample,
        });
    }
}
