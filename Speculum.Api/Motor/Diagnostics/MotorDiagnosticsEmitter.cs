using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Motor.Live;
using Speculum.Api.Motor.Sidecar;

namespace Speculum.Api.Motor.Diagnostics;

/// <summary>
/// Routing fields shared by every <c>Motor.*</c> emit. Built once at the call site so
/// the emitter stays a thin, payload-owning layer over the transport.
/// </summary>
public readonly record struct MotorDiagnosticsContext(
    string? ConnectionId,
    string? CorrelationId,
    string? PersistedSessionId,
    string? SidecarSessionId)
{
    public static MotorDiagnosticsContext For(
        string connectionId,
        string? correlationId,
        IMotorSession? session = null,
        string? persistedSessionId = null)
        => new(
            connectionId,
            correlationId,
            persistedSessionId ?? session?.PersistedSessionId,
            session?.SidecarSessionId);

    /// <summary>Drain-wide events (DrainStarted/Completed) with no owning connection.</summary>
    public static MotorDiagnosticsContext Global(string? correlationId)
        => new(null, correlationId, null, null);
}

/// <summary>
/// Domain emitter for <c>Motor.*</c> events. Owns their stable payload shapes and the
/// error-code classification. Event/Metric detail emits (Resize, SidecarFault, StatusMirror)
/// are gated + sampled here; the transport itself remains domain-agnostic.
/// </summary>
public interface IMotorDiagnosticsEmitter
{
    /// <summary>Lifecycle emit with a caller-supplied payload (Metric-tier events).</summary>
    void Emit(
        MotorDiagnosticsContext ctx,
        string name,
        object? payload = null,
        DiagnosticsSeverity severity = DiagnosticsSeverity.Information);

    void StateExportCompleted(
        MotorDiagnosticsContext ctx,
        int? cookieCount,
        int? localStorageCount,
        int? historyCount);

    void StateExportFailed(MotorDiagnosticsContext ctx, Exception ex);

    void SessionStartFailed(
        MotorDiagnosticsContext ctx,
        string? phase,
        Exception ex,
        DiagnosticsSeverity severity,
        bool? restored,
        bool? stateLoaded,
        int? cookieCount);

    void NavigateRejected(MotorDiagnosticsContext ctx, string? message, string? clientUrl, string? targetUrl);

    void SidecarFaulted(MotorDiagnosticsContext ctx, string fault);
    void ResizeRequested(MotorDiagnosticsContext ctx, int width, int height);
    void UrlMapped(MotorDiagnosticsContext ctx, string targetUrl, string clientUrl);
    void StatusMirrored(MotorDiagnosticsContext ctx, double fps, long uptimeMs, int tabCount, int width, int height);
}

public sealed class MotorDiagnosticsEmitter : IMotorDiagnosticsEmitter
{
    public const int MessageMaxChars = 512;

    private readonly IDiagnosticsEventBus _bus;
    private readonly IDiagnosticsRuntime _runtime;

    public MotorDiagnosticsEmitter(IDiagnosticsEventBus bus, IDiagnosticsRuntime runtime)
    {
        _bus = bus;
        _runtime = runtime;
    }

    public void Emit(
        MotorDiagnosticsContext ctx,
        string name,
        object? payload = null,
        DiagnosticsSeverity severity = DiagnosticsSeverity.Information)
        => _bus.Publish(BuildEvent(ctx, name, payload, severity));

    public void StateExportCompleted(
        MotorDiagnosticsContext ctx,
        int? cookieCount,
        int? localStorageCount,
        int? historyCount)
        => Emit(ctx, "Motor.StateExportCompleted", new Dictionary<string, object?>
        {
            ["persistedSessionId"] = ctx.PersistedSessionId,
            ["cookieCount"] = cookieCount,
            ["localStorageCount"] = localStorageCount,
            ["historyCount"] = historyCount,
        });

    public void StateExportFailed(MotorDiagnosticsContext ctx, Exception ex)
        => Emit(ctx, "Motor.StateExportFailed", new Dictionary<string, object?>
        {
            ["errorCode"] = ClassifyExportError(ex),
            ["phase"] = "export",
            ["message"] = Truncate(ex.Message),
            ["persistedSessionId"] = ctx.PersistedSessionId,
        }, DiagnosticsSeverity.Warning);

    public void SessionStartFailed(
        MotorDiagnosticsContext ctx,
        string? phase,
        Exception ex,
        DiagnosticsSeverity severity,
        bool? restored,
        bool? stateLoaded,
        int? cookieCount)
    {
        var safePhase = string.IsNullOrEmpty(phase) ? "sidecar_create" : phase;
        Emit(ctx, "Motor.SessionStartFailed", new Dictionary<string, object?>
        {
            ["errorCode"] = ClassifyStartFailure(ex, safePhase),
            ["phase"] = safePhase,
            ["message"] = Truncate(ex.Message),
            ["persistedSessionId"] = ctx.PersistedSessionId,
            ["restored"] = restored,
            ["stateLoaded"] = stateLoaded,
            ["cookieCount"] = cookieCount,
        }, severity);
    }

    public void NavigateRejected(MotorDiagnosticsContext ctx, string? message, string? clientUrl, string? targetUrl)
        => Emit(ctx, "Motor.NavigateRejected", new Dictionary<string, object?>
        {
            ["errorCode"] = "navigate_rejected",
            ["phase"] = "navigate",
            ["message"] = Truncate(message),
            ["clientUrl"] = clientUrl,
            ["targetUrl"] = targetUrl,
        }, DiagnosticsSeverity.Warning);

    public void SidecarFaulted(MotorDiagnosticsContext ctx, string fault)
    {
        if (!_runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Event))
            return;

        var errorCode = string.Equals(fault, "sidecar_channel_closed", StringComparison.Ordinal)
            ? "sidecar_channel_closed"
            : "sidecar_fault";
        Emit(ctx, "Motor.SidecarFaulted", new Dictionary<string, object?>
        {
            ["fault"] = Truncate(fault),
            ["errorCode"] = errorCode,
        }, DiagnosticsSeverity.Error);
    }

    public void ResizeRequested(MotorDiagnosticsContext ctx, int width, int height)
    {
        if (!_runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Event))
            return;

        Emit(ctx, "Motor.ResizeRequested", new { width, height });
    }

    public void UrlMapped(MotorDiagnosticsContext ctx, string targetUrl, string clientUrl)
        => Emit(ctx, "Motor.UrlMapped", new { targetUrl, clientUrl });

    public void StatusMirrored(MotorDiagnosticsContext ctx, double fps, long uptimeMs, int tabCount, int width, int height)
    {
        if (!_runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric))
            return;

        var sampling = _runtime.GetSnapshot().Options.Sampling;
        var mirrorRatio = Math.Min(sampling.StatusMirrorRatio, sampling.ExpensiveEventRatio);
        if (mirrorRatio <= 0)
            return;
        if (mirrorRatio < 1.0 && Random.Shared.NextDouble() > mirrorRatio)
            return;

        _bus.Publish(
            BuildEvent(ctx, "Motor.StatusMirrored",
                new { fps, uptimeMs, tabCount, width, height },
                DiagnosticsSeverity.Information),
            persist: false);
    }

    private static DiagnosticsEvent BuildEvent(
        MotorDiagnosticsContext ctx,
        string name,
        object? payload,
        DiagnosticsSeverity severity)
        => new()
        {
            Domain = DiagnosticsDomain.MotorLive,
            Name = name,
            Severity = severity,
            CorrelationId = ctx.CorrelationId,
            ConnectionId = ctx.ConnectionId,
            PersistedSessionId = ctx.PersistedSessionId,
            SidecarSessionId = ctx.SidecarSessionId,
            Payload = payload,
        };

    public static string ClassifyStartFailure(Exception ex, string phase)
    {
        if (ex is SidecarProtocolException spe)
            return spe.ErrorCode;
        if (ex is OperationCanceledException)
            return "session_cancelled";
        if (phase == "promote")
            return "session_cancelled";
        if (string.Equals(ex.Message, "Sessão cancelada durante startup.", StringComparison.Ordinal))
            return "session_cancelled";
        return "session_start_failed";
    }

    private static string ClassifyExportError(Exception ex)
        => ex is SidecarProtocolException spe ? spe.ErrorCode : "export_failed";

    private static string Truncate(string? message)
    {
        if (string.IsNullOrEmpty(message)) return "";
        return message.Length <= MessageMaxChars ? message : message[..MessageMaxChars];
    }
}
