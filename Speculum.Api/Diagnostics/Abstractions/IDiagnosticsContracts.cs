namespace Speculum.Api.Diagnostics.Abstractions;

public interface IDiagnosticsRuntime
{
    bool Enabled { get; }
    bool IsDegraded { get; }
    DiagnosticsLevel GetEffectiveLevel(DiagnosticsDomain domain);
    bool IsEnabled(DiagnosticsDomain domain, DiagnosticsLevel minimum);
    DiagnosticsRuntimeSnapshot GetSnapshot();
    void ApplyOptions(Diagnostics.Configuration.DiagnosticsOptions options);
    void SetElevate(DiagnosticsLevel? browserQueryFloor, TimeSpan? ttl);
    void ClearElevate();
    void ReportPublishDropped();
    void ReportOverflow();
    void SetDegraded(bool degraded);
}

public sealed class DiagnosticsRuntimeSnapshot
{
    public bool Enabled { get; init; }
    public bool Degraded { get; init; }
    public IReadOnlyDictionary<string, string> EffectiveLevels { get; init; }
        = new Dictionary<string, string>();
    public object? Elevate { get; init; }
    public long BytesUsed { get; init; }
    public long EventsStored { get; init; }
    public long EventsDropped { get; init; }
    public long OverflowCount { get; init; }
    public int ProbeInFlight { get; init; }
    public DateTimeOffset? LastCleanupUtc { get; init; }
    public int DiagnosticsSchemaVersion { get; init; } = DiagnosticsSchema.Version;
    public string RedactionMode { get; init; } = "none";
    public Configuration.DiagnosticsOptions Options { get; init; } = new();
}

public interface IDiagnosticsEventBus
{
    void Publish(DiagnosticsEvent diagnosticsEvent, bool persist = true);
}

public interface IDiagnosticsSink
{
    ValueTask WriteAsync(DiagnosticsEvent diagnosticsEvent, CancellationToken ct = default);
}

public interface IDiagnosticsRedactor
{
    string Mode { get; }
    object? RedactPayload(object? payload);
    object RedactSessionSnapshot(object snapshot);
    object RedactPersistedDetail(object detail);
    object RedactProbeResult(object result);
}

public interface IDiagnosticsProbeProvider
{
    string Name { get; }
    Task<ProbeResult> ExecuteAsync(ProbeRequest request, CancellationToken ct = default);
}

public sealed class ProbeRequest
{
    public string ConnectionId { get; init; } = "";
    public IReadOnlyList<string> Ops { get; init; } = [];
    public string? EvaluateExpression { get; init; }
    public string? DomSelector { get; init; }
    public string? CorrelationId { get; init; }
    public int? MaxProbeResponseBytes { get; init; }
}

public sealed class ProbeResult
{
    public bool Ok { get; init; }
    public string? ErrorCode { get; init; }
    public object? Data { get; init; }
}
