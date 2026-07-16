using System.Text.Json.Serialization;

namespace Speculum.Api.Diagnostics.Emitters;

/// <summary>
/// Typed payload records for <c>Diagnostics.*</c> self events and <c>Sidecar.DiagProbe*</c>
/// events (Option B). The emitter owns these shapes; optional audit/error fields are omitted
/// when unset so the JSON wire matches the previous anonymous-object shapes exactly.
/// </summary>
public sealed record DiagnosticsConfigAppliedPayload(bool Enabled, string Profile);

public sealed record DiagnosticsElevateStartedPayload(int Minutes, string ActorIp, bool Audit);

/// <summary>Reason plus optional audit fields (ElevateExpired / Recovered).</summary>
public sealed record DiagnosticsAuditReasonPayload(
    string Reason,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ActorIp,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Audit);

public sealed record DiagnosticsReasonPayload(string Reason);

public sealed record DiagnosticsStorageOverflowPayload(long MaxBytes, int Dropped, string Overflow);

public sealed record DiagnosticsCleanupPurgedPayload(int Purged);

public sealed record SidecarProbePayload(
    string[] Ops,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ErrorCode);

public sealed record SidecarProbeBusyPayload(string ErrorCode);
