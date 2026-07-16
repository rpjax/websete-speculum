using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Pipeline;
using Speculum.Api.Motor.Live;
using Speculum.Api.Motor.Sidecar;

namespace Speculum.Api.Motor.Diagnostics;

/// <summary>
/// Context-bound producer for <c>Motor.*</c> events. Holds the routing context (connection,
/// correlation, and — once attached — the live session) so call sites stay dumb: they pass only
/// domain values, never IDs. The producer owns the typed payload shapes, capability gating, and
/// errorCode/phase classification; the transport (<see cref="IDiagnosticsEventBus"/>) stays
/// domain-agnostic. A handle is created per operation/story via <see cref="IMotorEventsFactory"/>.
/// </summary>
public interface IMotorEvents
{
    /// <summary>Attaches the live session so persisted/sidecar identity is read from it at emit time.</summary>
    void Attach(IMotorSession session);

    /// <summary>Sets the persisted session id before a session object exists (startup resolve).</summary>
    void SetPersistedSessionId(string persistedSessionId);

    void SessionStarting(string clientUrl, int width, int height, bool clientTokenProvided);
    void SessionResolved(
        bool clientTokenProvided, string? clientTokenEffective, bool restored, bool stateLoaded,
        int cookieCount, int localStorageCount, int historyCount, string initialUrl);
    void SidecarConnected();
    void SessionPromoted(bool restored);
    void SessionStarted(bool restored);
    void SessionStopping(string reason);
    void SessionStopped(string reason);
    void SidecarDisconnected();
    void SlotAcquired(int? maxSessions, int activeCount, int startingCount);
    void SlotReleased(int? maxSessions, int activeCount, int startingCount);

    void StateExportRequested();
    void StateExportCompleted(int? cookieCount, int? localStorageCount, int? historyCount);
    void StateExportFailed(Exception ex);

    void SessionStartFailed(
        string? phase, Exception ex, DiagnosticsSeverity severity,
        bool? restored, bool? stateLoaded, int? cookieCount);

    void NavigateRequested(string targetUrl, string clientUrl);
    void NavigateCompleted(string targetUrl);
    void NavigateRejected(string? message, string? clientUrl, string? targetUrl);

    /// <summary>Navigate refused before a target could be built (allowlist / mapping block).</summary>
    void NavigateBlocked(string? message, string clientUrl);

    /// <summary>Session refused at the capacity gate (max concurrent sessions reached).</summary>
    void SessionRefused(int maxSessions, int activeCount, int startingCount);

    void SidecarFaulted(string fault);
    void Resize(int width, int height);
    void InputRejected(string rejectReason, string? inputType);
    void UrlMapped(string targetUrl, string clientUrl);
    void StatusMirror(double fps, long uptimeMs, int tabCount, int width, int height);

    void DrainStarted(string sectionKey, int sessionCount);
    void DrainCompleted(string sectionKey, int sessionCountBefore, int sessionCountAfter);

    /// <summary>
    /// Teardown seam: abandons any spans still open in this handle's scope (connection or drain
    /// correlation), emitting a synthetic <c>Diagnostics.SpanAbandoned</c> close for each.
    /// </summary>
    void CloseOpenSpans(string reason);
}

/// <summary>Creates context-bound <see cref="IMotorEvents"/> handles.</summary>
public interface IMotorEventsFactory
{
    /// <summary>Handle bound to a connection/correlation before any session object exists (startup).</summary>
    IMotorEvents Begin(string connectionId, string correlationId);

    /// <summary>Handle bound to a live session (reads persisted/sidecar identity from it).</summary>
    IMotorEvents ForSession(string connectionId, string correlationId, IMotorSession session);

    /// <summary>Connection-less handle for drain-wide events.</summary>
    IMotorEvents BeginGlobal(string correlationId);
}

public sealed class MotorEventsFactory : IMotorEventsFactory
{
    private readonly IDiagnosticsEventBus _bus;
    private readonly IDiagnosticsRuntime _runtime;
    private readonly SpanTracker _spans;

    public MotorEventsFactory(IDiagnosticsEventBus bus, IDiagnosticsRuntime runtime, SpanTracker spans)
    {
        _bus = bus;
        _runtime = runtime;
        _spans = spans;
    }

    public IMotorEvents Begin(string connectionId, string correlationId)
        => new MotorEvents(_bus, _runtime, _spans, connectionId, correlationId, session: null);

    public IMotorEvents ForSession(string connectionId, string correlationId, IMotorSession session)
        => new MotorEvents(_bus, _runtime, _spans, connectionId, correlationId, session);

    public IMotorEvents BeginGlobal(string correlationId)
        => new MotorEvents(_bus, _runtime, _spans, connectionId: null, correlationId, session: null);
}

public sealed class MotorEvents : IMotorEvents
{
    public const int MessageMaxChars = 512;

    private readonly IDiagnosticsEventBus _bus;
    private readonly IDiagnosticsRuntime _runtime;
    private readonly SpanTracker _spans;
    private readonly string? _connectionId;
    private readonly string? _correlationId;
    private IMotorSession? _session;
    private string? _persistedSessionId;

    public MotorEvents(
        IDiagnosticsEventBus bus,
        IDiagnosticsRuntime runtime,
        SpanTracker spans,
        string? connectionId,
        string? correlationId,
        IMotorSession? session)
    {
        _bus = bus;
        _runtime = runtime;
        _spans = spans;
        _connectionId = connectionId;
        _correlationId = correlationId;
        _session = session;
    }

    public void Attach(IMotorSession session) => _session = session;

    public void SetPersistedSessionId(string persistedSessionId) => _persistedSessionId = persistedSessionId;

    public void SessionStarting(string clientUrl, int width, int height, bool clientTokenProvided)
        => Publish("Motor.SessionStarting",
            new MotorSessionStartingPayload(clientUrl, width, height, clientTokenProvided));

    public void SessionResolved(
        bool clientTokenProvided, string? clientTokenEffective, bool restored, bool stateLoaded,
        int cookieCount, int localStorageCount, int historyCount, string initialUrl)
        => Publish("Motor.SessionResolved",
            new MotorSessionResolvedPayload(
                clientTokenProvided, clientTokenEffective, restored, stateLoaded,
                cookieCount, localStorageCount, historyCount, initialUrl));

    public void SidecarConnected() => Publish("Motor.SidecarConnected", payload: null);

    public void SessionPromoted(bool restored)
        => Publish("Motor.SessionPromoted", new MotorSessionRestoredPayload(restored));

    public void SessionStarted(bool restored)
        => Publish("Motor.SessionStarted", new MotorSessionRestoredPayload(restored));

    public void SessionStopping(string reason)
        => Publish("Motor.SessionStopping", new MotorSessionReasonPayload(reason));

    public void SessionStopped(string reason)
        => Publish("Motor.SessionStopped", new MotorSessionReasonPayload(reason));

    public void SidecarDisconnected() => Publish("Motor.SidecarDisconnected", payload: null);

    public void SlotAcquired(int? maxSessions, int activeCount, int startingCount)
        => Publish("Motor.SlotAcquired", new MotorSlotPayload(maxSessions, activeCount, startingCount));

    public void SlotReleased(int? maxSessions, int activeCount, int startingCount)
        => Publish("Motor.SlotReleased", new MotorSlotPayload(maxSessions, activeCount, startingCount));

    public void StateExportRequested() => Publish("Motor.StateExportRequested", payload: null);

    public void StateExportCompleted(int? cookieCount, int? localStorageCount, int? historyCount)
        => Publish("Motor.StateExportCompleted",
            new MotorStateExportCompletedPayload(cookieCount, localStorageCount, historyCount));

    public void StateExportFailed(Exception ex)
        => Publish("Motor.StateExportFailed",
            new MotorStateExportFailedPayload(ClassifyExportError(ex), "export", Truncate(ex.Message)),
            DiagnosticsSeverity.Warning);

    public void SessionStartFailed(
        string? phase, Exception ex, DiagnosticsSeverity severity,
        bool? restored, bool? stateLoaded, int? cookieCount)
    {
        var safePhase = string.IsNullOrEmpty(phase) ? "sidecar_create" : phase;
        Publish("Motor.SessionStartFailed",
            new MotorSessionStartFailedPayload(
                ClassifyStartFailure(ex, safePhase), safePhase, Truncate(ex.Message),
                restored, stateLoaded, cookieCount),
            severity);
    }

    public void NavigateRequested(string targetUrl, string clientUrl)
        => Publish("Motor.NavigateRequested", new MotorNavigateRequestedPayload(targetUrl, clientUrl));

    public void NavigateCompleted(string targetUrl)
        => Publish("Motor.NavigateCompleted", new MotorNavigateCompletedPayload(targetUrl));

    public void NavigateRejected(string? message, string? clientUrl, string? targetUrl)
        => Publish("Motor.NavigateRejected",
            new MotorNavigateRejectedPayload("navigate_rejected", "navigate", Truncate(message), clientUrl, targetUrl),
            DiagnosticsSeverity.Warning);

    public void NavigateBlocked(string? message, string clientUrl)
        => Publish("Motor.NavigateBlocked",
            new MotorNavigateBlockedPayload("url_blocked", "build_target", Truncate(message), clientUrl),
            DiagnosticsSeverity.Warning);

    public void SessionRefused(int maxSessions, int activeCount, int startingCount)
        => Publish("Motor.SessionRefused",
            new MotorSessionRefusedPayload("session_limit", "acquire_slot", maxSessions, activeCount, startingCount),
            DiagnosticsSeverity.Warning);

    public void SidecarFaulted(string fault)
    {
        if (!_runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Event))
            return;

        var errorCode = string.Equals(fault, "sidecar_channel_closed", StringComparison.Ordinal)
            ? "sidecar_channel_closed"
            : "sidecar_fault";
        Publish("Motor.SidecarFaulted",
            new MotorSidecarFaultedPayload(Truncate(fault), errorCode),
            DiagnosticsSeverity.Error);
    }

    public void Resize(int width, int height)
    {
        if (!_runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Event))
            return;

        Publish("Motor.ResizeRequested", new MotorResizePayload(width, height));
    }

    public void InputRejected(string rejectReason, string? inputType)
    {
        if (!_runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Event))
            return;

        var errorCode = string.IsNullOrWhiteSpace(rejectReason)
            ? "input_blocked"
            : rejectReason.Contains("JSON", StringComparison.OrdinalIgnoreCase)
                ? "invalid_json"
                : "input_blocked";
        Publish("Motor.InputRejected",
            new MotorInputRejectedPayload(errorCode, "validate", Truncate(rejectReason), inputType),
            DiagnosticsSeverity.Warning);
    }

    public void UrlMapped(string targetUrl, string clientUrl)
        => Publish("Motor.UrlMapped", new MotorUrlMappedPayload(targetUrl, clientUrl));

    public void StatusMirror(double fps, long uptimeMs, int tabCount, int width, int height)
    {
        if (!_runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric))
            return;

        var sampling = _runtime.GetSnapshot().Options.Sampling;
        var mirrorRatio = Math.Min(sampling.StatusMirrorRatio, sampling.ExpensiveEventRatio);
        if (mirrorRatio <= 0)
            return;
        if (mirrorRatio < 1.0 && Random.Shared.NextDouble() > mirrorRatio)
            return;

        Publish("Motor.StatusMirrored",
            new MotorStatusMirrorPayload(fps, uptimeMs, tabCount, width, height),
            DiagnosticsSeverity.Information,
            persist: false);
    }

    public void DrainStarted(string sectionKey, int sessionCount)
        => Publish("Motor.DrainStarted", new MotorDrainStartedPayload(sectionKey, sessionCount));

    public void DrainCompleted(string sectionKey, int sessionCountBefore, int sessionCountAfter)
        => Publish("Motor.DrainCompleted",
            new MotorDrainCompletedPayload(sectionKey, sessionCountBefore, sessionCountAfter));

    public void CloseOpenSpans(string reason)
        => _spans.CloseScope(_connectionId ?? _correlationId, reason);

    private void Publish(
        string name, object? payload,
        DiagnosticsSeverity severity = DiagnosticsSeverity.Information,
        bool persist = true)
        => _bus.Publish(BuildEvent(name, payload, severity), persist);

    private DiagnosticsEvent BuildEvent(string name, object? payload, DiagnosticsSeverity severity)
        => new()
        {
            Domain = DiagnosticsDomain.MotorLive,
            Name = name,
            Severity = severity,
            CorrelationId = _correlationId,
            ConnectionId = _connectionId,
            PersistedSessionId = _persistedSessionId ?? _session?.PersistedSessionId,
            SidecarSessionId = _session?.SidecarSessionId,
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
