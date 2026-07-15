using Speculum.Api.Diagnostics.Abstractions;

namespace Speculum.Api.Diagnostics.Emitters;

/// <summary>
/// Domain emitter for <c>Diagnostics.*</c> self events. Owns their payload shapes;
/// the transport gates purely on the catalog descriptor (Self is always-on when enabled).
/// </summary>
public interface IDiagnosticsSelfEmitter
{
    void ConfigApplied(bool enabled, string profile);
    void ElevateStarted(int minutes, string actorIp);
    void ElevateExpired(string reason, string? actorIp = null);
    void StorageOverflow(long maxBytes, int dropped, string overflow);
    void Degraded(string reason);
    void Recovered(string reason, string? actorIp = null);
    void CleanupPurged(int purged);
}

public sealed class DiagnosticsSelfEmitter : IDiagnosticsSelfEmitter
{
    private readonly IDiagnosticsEventBus _bus;

    public DiagnosticsSelfEmitter(IDiagnosticsEventBus bus) => _bus = bus;

    public void ConfigApplied(bool enabled, string profile)
        => Publish("Diagnostics.ConfigApplied", DiagnosticsSeverity.Information, new { enabled, profile });

    public void ElevateStarted(int minutes, string actorIp)
        => Publish("Diagnostics.ElevateStarted", DiagnosticsSeverity.Information,
            new { minutes, actorIp, audit = true });

    public void ElevateExpired(string reason, string? actorIp = null)
        => Publish("Diagnostics.ElevateExpired", DiagnosticsSeverity.Information,
            actorIp is null
                ? new { reason }
                : (object)new { reason, actorIp, audit = true });

    public void StorageOverflow(long maxBytes, int dropped, string overflow)
        => Publish("Diagnostics.StorageOverflow", DiagnosticsSeverity.Warning,
            new { maxBytes, dropped, overflow });

    public void Degraded(string reason)
        => Publish("Diagnostics.Degraded", DiagnosticsSeverity.Warning, new { reason });

    public void Recovered(string reason, string? actorIp = null)
        => Publish("Diagnostics.Recovered", DiagnosticsSeverity.Information,
            actorIp is null
                ? new { reason }
                : (object)new { reason, actorIp, audit = true });

    public void CleanupPurged(int purged)
        => Publish("Diagnostics.CleanupPurged", DiagnosticsSeverity.Information, new { purged });

    private void Publish(string name, DiagnosticsSeverity severity, object payload)
        => _bus.Publish(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.DiagnosticsSelf,
            Name = name,
            Severity = severity,
            Payload = payload,
        });
}
