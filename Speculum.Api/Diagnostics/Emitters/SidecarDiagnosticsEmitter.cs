using Speculum.Api.Diagnostics.Abstractions;

namespace Speculum.Api.Diagnostics.Emitters;

/// <summary>
/// Domain emitter for <c>Sidecar.DiagProbe*</c> events. Owns the probe payload shape;
/// the transport gates on the catalog descriptor + SidecarBrowser capability.
/// </summary>
public interface ISidecarDiagnosticsEmitter
{
    void ProbeRequested(string connectionId, string? correlationId, string? persistedSessionId, string[] ops);
    void ProbeCompleted(string connectionId, string? correlationId, string? persistedSessionId, string[] ops);
    void ProbeRejected(string connectionId, string? correlationId, string[] ops, string errorCode);
    void ProbeTimedOut(string connectionId, string? correlationId, string[] ops, string errorCode = "probe_timeout");

    /// <summary>Concurrency-gate rejection before a correlation id is assigned.</summary>
    void ProbeBusyRejected(string connectionId);
}

public sealed class SidecarDiagnosticsEmitter : ISidecarDiagnosticsEmitter
{
    private readonly IDiagnosticsEventBus _bus;

    public SidecarDiagnosticsEmitter(IDiagnosticsEventBus bus) => _bus = bus;

    public void ProbeRequested(string connectionId, string? correlationId, string? persistedSessionId, string[] ops)
        => Publish("Sidecar.DiagProbeRequested", DiagnosticsSeverity.Information,
            connectionId, correlationId, persistedSessionId, ProbePayload(ops));

    public void ProbeCompleted(string connectionId, string? correlationId, string? persistedSessionId, string[] ops)
        => Publish("Sidecar.DiagProbeCompleted", DiagnosticsSeverity.Information,
            connectionId, correlationId, persistedSessionId, ProbePayload(ops));

    public void ProbeRejected(string connectionId, string? correlationId, string[] ops, string errorCode)
        => Publish("Sidecar.DiagProbeRejected", DiagnosticsSeverity.Warning,
            connectionId, correlationId, persistedSessionId: null, ProbePayload(ops, errorCode));

    public void ProbeTimedOut(string connectionId, string? correlationId, string[] ops, string errorCode = "probe_timeout")
        => Publish("Sidecar.DiagProbeTimedOut", DiagnosticsSeverity.Warning,
            connectionId, correlationId, persistedSessionId: null, ProbePayload(ops, errorCode));

    public void ProbeBusyRejected(string connectionId)
        => Publish("Sidecar.DiagProbeRejected", DiagnosticsSeverity.Warning,
            connectionId, Guid.NewGuid().ToString("N"), persistedSessionId: null,
            new Dictionary<string, object?> { ["errorCode"] = "probe_busy" });

    private void Publish(
        string name,
        DiagnosticsSeverity severity,
        string connectionId,
        string? correlationId,
        string? persistedSessionId,
        object payload)
        => _bus.Publish(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.SidecarBrowser,
            Name = name,
            Severity = severity,
            CorrelationId = correlationId,
            ConnectionId = connectionId,
            PersistedSessionId = persistedSessionId,
            Payload = payload,
        });

    private static object ProbePayload(string[] ops, string? errorCode = null)
    {
        var map = new Dictionary<string, object?> { ["ops"] = ops };
        if (!string.IsNullOrWhiteSpace(errorCode))
            map["errorCode"] = errorCode;
        return map;
    }
}
