namespace Speculum.Api.Diagnostics.Abstractions;

public interface IDiagnosticsRuntime
{
    bool Enabled { get; }
    bool IsDegraded { get; }
    bool IsCapabilityEnabled(DiagnosticsDomain domain, DiagnosticsCapability capability);
    DiagnosticsRuntimeSnapshot GetSnapshot();
    void ApplyOptions(Diagnostics.Configuration.DiagnosticsOptions options);
    void SetElevate(TimeSpan? ttl);
    void ClearElevate();
    void ReportPublishDropped();
    void ReportOverflow();
    void SetDegraded(bool degraded);
}

public sealed class DiagnosticsRuntimeSnapshot
{
    public bool Enabled { get; init; }
    public bool Degraded { get; init; }

    /// <summary>Resolved capabilities (post degraded/elevate) per domain: domain -> {capability -> enabled}.</summary>
    public IReadOnlyDictionary<string, IReadOnlyDictionary<string, bool>> EffectiveCapabilities { get; init; }
        = new Dictionary<string, IReadOnlyDictionary<string, bool>>();

    /// <summary>Always-present elevate projection: { active, expiresUtc }.</summary>
    public object? Elevate { get; init; }

    /// <summary>Strongly-typed elevate-active flag (same truth as <see cref="Elevate"/>.active) for internal consumers.</summary>
    public bool ElevateActive { get; init; }
    public long BytesUsed { get; init; }
    public long StorageMaxBytes { get; init; }
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
