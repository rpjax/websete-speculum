namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input;

/// <summary>Unified input failure telemetry (§10.7).</summary>
public sealed record InputFailureEvent(string ErrorCode, string Phase);
