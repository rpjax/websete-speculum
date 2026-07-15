using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Motor.Live;

namespace Speculum.Api.Diagnostics.Telemetry;

/// <summary>
/// Composes a <see cref="TelemetrySample"/> from the section sources, pulling each section
/// lazily by its toggle. Motor + Sidecar share a single registry snapshot pass per tick.
/// </summary>
public interface ITelemetrySampleComposer
{
    Task<TelemetrySample> ComposeAsync(DiagnosticsTelemetryOptions telemetry, CancellationToken ct = default);
}

public sealed class TelemetrySampleComposer : ITelemetrySampleComposer
{
    private readonly IHostTelemetrySource _host;
    private readonly IMotorTelemetrySource _motor;
    private readonly ISidecarTelemetrySource _sidecar;
    private readonly IPersistenceTelemetrySource _persistence;
    private readonly IPipelineTelemetrySource _pipeline;
    private readonly IMotorSessionRegistry _registry;

    public TelemetrySampleComposer(
        IHostTelemetrySource host,
        IMotorTelemetrySource motor,
        ISidecarTelemetrySource sidecar,
        IPersistenceTelemetrySource persistence,
        IPipelineTelemetrySource pipeline,
        IMotorSessionRegistry registry)
    {
        _host = host;
        _motor = motor;
        _sidecar = sidecar;
        _persistence = persistence;
        _pipeline = pipeline;
        _registry = registry;
    }

    public async Task<TelemetrySample> ComposeAsync(
        DiagnosticsTelemetryOptions telemetry,
        CancellationToken ct = default)
    {
        var host = telemetry.Host.Enabled ? _host.Collect() : null;

        // One in-memory registry pass shared by both motor and sidecar sections.
        IReadOnlyList<MotorSessionDiagnosticsSnapshot>? snapshots =
            telemetry.Motor.Enabled || telemetry.Sidecar.Enabled
                ? _registry.ListSnapshots()
                : null;

        var motor = telemetry.Motor.Enabled
            ? _motor.Collect(snapshots!, telemetry.Motor)
            : null;
        var sidecar = telemetry.Sidecar.Enabled
            ? _sidecar.Collect(snapshots!, telemetry.Sidecar)
            : null;
        var persistence = telemetry.Persistence.Enabled
            ? await _persistence.CollectAsync(telemetry.Persistence, ct)
            : null;
        var pipeline = telemetry.Pipeline.Enabled
            ? _pipeline.Collect(telemetry.Pipeline)
            : null;

        return new TelemetrySample(host, motor, sidecar, persistence, pipeline);
    }
}
