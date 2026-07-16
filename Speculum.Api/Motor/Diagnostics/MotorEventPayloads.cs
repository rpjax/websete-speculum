using System.Text.Json.Serialization;

namespace Speculum.Api.Motor.Diagnostics;

/// <summary>
/// Typed payload records for <c>Motor.*</c> events (Option B). The producer owns these shapes;
/// callers pass only domain values. Correlation/session identity lives on the event envelope
/// (stamped by the handle), never inside the payload.
/// </summary>
public sealed record MotorSessionStartingPayload(
    string ClientUrl, int Width, int Height, bool ClientTokenProvided);

public sealed record MotorSessionReasonPayload(string Reason);

/// <summary>MaxSessions is omitted when unknown (drain path has no config store).</summary>
public sealed record MotorSlotPayload(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? MaxSessions,
    int ActiveCount,
    int StartingCount);

public sealed record MotorSessionResolvedPayload(
    bool ClientTokenProvided,
    string? ClientTokenEffective,
    bool Restored,
    bool StateLoaded,
    int CookieCount,
    int LocalStorageCount,
    int HistoryCount,
    string InitialUrl);

public sealed record MotorSessionRestoredPayload(bool Restored);

public sealed record MotorNavigateRequestedPayload(string TargetUrl, string ClientUrl);

public sealed record MotorNavigateCompletedPayload(string TargetUrl);

public sealed record MotorNavigateRejectedPayload(
    string ErrorCode, string Phase, string Message, string? ClientUrl, string? TargetUrl);

/// <summary>Navigate refused before a target could be built (allowlist / mapping block).</summary>
public sealed record MotorNavigateBlockedPayload(
    string ErrorCode, string Phase, string Message, string ClientUrl);

/// <summary>Session refused at the capacity gate (max concurrent sessions reached).</summary>
public sealed record MotorSessionRefusedPayload(
    string ErrorCode, string Phase, int MaxSessions, int ActiveCount, int StartingCount);

public sealed record MotorStateExportCompletedPayload(
    int? CookieCount, int? LocalStorageCount, int? HistoryCount);

public sealed record MotorStateExportFailedPayload(string ErrorCode, string Phase, string Message);

public sealed record MotorSessionStartFailedPayload(
    string ErrorCode, string Phase, string Message, bool? Restored, bool? StateLoaded, int? CookieCount);

public sealed record MotorSidecarFaultedPayload(string Fault, string ErrorCode);

public sealed record MotorResizePayload(int Width, int Height);

public sealed record MotorInputRejectedPayload(
    string ErrorCode, string Phase, string Message, string? InputType);

public sealed record MotorUrlMappedPayload(string TargetUrl, string ClientUrl);

public sealed record MotorStatusMirrorPayload(
    double Fps, long UptimeMs, int TabCount, int Width, int Height);

public sealed record MotorDrainStartedPayload(string SectionKey, int SessionCount);

public sealed record MotorDrainCompletedPayload(
    string SectionKey, int SessionCountBefore, int SessionCountAfter);
