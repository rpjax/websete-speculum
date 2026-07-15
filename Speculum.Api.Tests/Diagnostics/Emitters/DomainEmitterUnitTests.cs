using System.Text.Json;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Emitters;
using Speculum.Api.Diagnostics.Pipeline;
using Speculum.Api.Motor.Diagnostics;
using Speculum.Api.Motor.Sidecar;

namespace Speculum.Api.Tests;

/// <summary>
/// Locks the domain emitters' payload shapes and gating directly over a fake transport bus.
/// The emitters own payloads; the bus stays domain-agnostic.
/// </summary>
public sealed class DomainEmitterUnitTests
{
    // ---- DiagnosticsSelfEmitter ----

    [Fact]
    public void Self_ConfigApplied_emits_enabled_and_profile()
    {
        var bus = new CapturingBus();
        new DiagnosticsSelfEmitter(bus).ConfigApplied(enabled: true, profile: "Production");

        var evt = Assert.Single(bus.Events);
        Assert.Equal("Diagnostics.ConfigApplied", evt.Name);
        Assert.Equal(DiagnosticsDomain.DiagnosticsSelf, evt.Domain);
        var p = Payload(evt);
        Assert.True(p.GetProperty("enabled").GetBoolean());
        Assert.Equal("Production", p.GetProperty("profile").GetString());
    }

    [Fact]
    public void Self_ElevateStarted_is_audited_with_actor_and_minutes()
    {
        var bus = new CapturingBus();
        new DiagnosticsSelfEmitter(bus).ElevateStarted(minutes: 20, actorIp: "10.0.0.1");

        var evt = Assert.Single(bus.Events);
        Assert.Equal("Diagnostics.ElevateStarted", evt.Name);
        var p = Payload(evt);
        Assert.Equal(20, p.GetProperty("minutes").GetInt32());
        Assert.Equal("10.0.0.1", p.GetProperty("actorIp").GetString());
        Assert.True(p.GetProperty("audit").GetBoolean());
    }

    [Fact]
    public void Self_ElevateExpired_ttl_has_reason_only_no_audit()
    {
        var bus = new CapturingBus();
        new DiagnosticsSelfEmitter(bus).ElevateExpired("ttl");

        var evt = Assert.Single(bus.Events);
        Assert.Equal("Diagnostics.ElevateExpired", evt.Name);
        var p = Payload(evt);
        Assert.Equal("ttl", p.GetProperty("reason").GetString());
        Assert.False(p.TryGetProperty("actorIp", out _));
        Assert.False(p.TryGetProperty("audit", out _));
    }

    [Fact]
    public void Self_ElevateExpired_manual_clear_is_audited()
    {
        var bus = new CapturingBus();
        new DiagnosticsSelfEmitter(bus).ElevateExpired("manual_clear", "10.0.0.2");

        var evt = Assert.Single(bus.Events);
        var p = Payload(evt);
        Assert.Equal("manual_clear", p.GetProperty("reason").GetString());
        Assert.Equal("10.0.0.2", p.GetProperty("actorIp").GetString());
        Assert.True(p.GetProperty("audit").GetBoolean());
    }

    [Fact]
    public void Self_StorageOverflow_carries_budget_and_drop_count()
    {
        var bus = new CapturingBus();
        new DiagnosticsSelfEmitter(bus).StorageOverflow(maxBytes: 65536, dropped: 7, overflow: "DropOldest");

        var evt = Assert.Single(bus.Events);
        Assert.Equal("Diagnostics.StorageOverflow", evt.Name);
        Assert.Equal(DiagnosticsSeverity.Warning, evt.Severity);
        var p = Payload(evt);
        Assert.Equal(65536, p.GetProperty("maxBytes").GetInt64());
        Assert.Equal(7, p.GetProperty("dropped").GetInt32());
        Assert.Equal("DropOldest", p.GetProperty("overflow").GetString());
    }

    [Fact]
    public void Self_Degraded_and_Recovered_reasons()
    {
        var bus = new CapturingBus();
        var self = new DiagnosticsSelfEmitter(bus);
        self.Degraded("drop_rate");
        self.Recovered("cleanup_cycle");

        Assert.Equal("Diagnostics.Degraded", bus.Events[0].Name);
        Assert.Equal(DiagnosticsSeverity.Warning, bus.Events[0].Severity);
        Assert.Equal("drop_rate", Payload(bus.Events[0]).GetProperty("reason").GetString());
        Assert.Equal("Diagnostics.Recovered", bus.Events[1].Name);
        Assert.Equal("cleanup_cycle", Payload(bus.Events[1]).GetProperty("reason").GetString());
    }

    // ---- SidecarDiagnosticsEmitter ----

    [Fact]
    public void Sidecar_ProbeRequested_carries_ops_and_routing()
    {
        var bus = new CapturingBus();
        new SidecarDiagnosticsEmitter(bus)
            .ProbeRequested("conn-1", "corr-1", "sess-1", ["cookies", "storage"]);

        var evt = Assert.Single(bus.Events);
        Assert.Equal("Sidecar.DiagProbeRequested", evt.Name);
        Assert.Equal(DiagnosticsDomain.SidecarBrowser, evt.Domain);
        Assert.Equal("conn-1", evt.ConnectionId);
        Assert.Equal("corr-1", evt.CorrelationId);
        Assert.Equal("sess-1", evt.PersistedSessionId);
        var ops = Payload(evt).GetProperty("ops").EnumerateArray().Select(x => x.GetString()!).ToArray();
        Assert.Equal(["cookies", "storage"], ops);
    }

    [Fact]
    public void Sidecar_ProbeTimedOut_has_errorCode_and_warning()
    {
        var bus = new CapturingBus();
        new SidecarDiagnosticsEmitter(bus).ProbeTimedOut("conn-1", "corr-1", ["cookies"]);

        var evt = Assert.Single(bus.Events);
        Assert.Equal("Sidecar.DiagProbeTimedOut", evt.Name);
        Assert.Equal(DiagnosticsSeverity.Warning, evt.Severity);
        Assert.Equal("probe_timeout", Payload(evt).GetProperty("errorCode").GetString());
    }

    [Fact]
    public void Sidecar_ProbeBusyRejected_has_errorCode_and_generated_correlation()
    {
        var bus = new CapturingBus();
        new SidecarDiagnosticsEmitter(bus).ProbeBusyRejected("conn-1");

        var evt = Assert.Single(bus.Events);
        Assert.Equal("Sidecar.DiagProbeRejected", evt.Name);
        Assert.Equal(DiagnosticsSeverity.Warning, evt.Severity);
        Assert.Equal("probe_busy", Payload(evt).GetProperty("errorCode").GetString());
        Assert.False(string.IsNullOrWhiteSpace(evt.CorrelationId));
    }

    // ---- MotorDiagnosticsEmitter gating ----

    [Fact]
    public void Motor_SidecarFaulted_dropped_when_Event_capability_off()
    {
        var bus = new CapturingBus();
        var emitter = new MotorDiagnosticsEmitter(bus, MetricsOnlyRuntime());

        emitter.SidecarFaulted(Ctx(), "sidecar_channel_closed");

        Assert.Empty(bus.Events);
    }

    [Fact]
    public void Motor_SidecarFaulted_emitted_with_errorCode_when_Event_on()
    {
        var bus = new CapturingBus();
        var emitter = new MotorDiagnosticsEmitter(bus, DevelopmentRuntime());

        emitter.SidecarFaulted(Ctx(), "sidecar_channel_closed");

        var evt = Assert.Single(bus.Events);
        Assert.Equal("Motor.SidecarFaulted", evt.Name);
        Assert.Equal(DiagnosticsSeverity.Error, evt.Severity);
        var p = Payload(evt);
        Assert.Equal("sidecar_channel_closed", p.GetProperty("fault").GetString());
        Assert.Equal("sidecar_channel_closed", p.GetProperty("errorCode").GetString());
    }

    [Fact]
    public void Motor_StatusMirrored_dropped_when_Metric_capability_off()
    {
        var bus = new CapturingBus();
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(new DiagnosticsOptions { Enabled = false });
        var emitter = new MotorDiagnosticsEmitter(bus, runtime);

        emitter.StatusMirrored(Ctx(), fps: 30, uptimeMs: 1000, tabCount: 1, width: 800, height: 600);

        Assert.Empty(bus.Events);
    }

    [Fact]
    public void Motor_StatusMirrored_never_persists()
    {
        var bus = new CapturingBus();
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(new DiagnosticsOptions
        {
            Enabled = true,
            Sampling = new DiagnosticsSamplingOptions
            {
                StatusMirrorRatio = 1.0,
                ExpensiveEventRatio = 1.0,
            },
        });
        var emitter = new MotorDiagnosticsEmitter(bus, runtime);

        emitter.StatusMirrored(Ctx(), fps: 30, uptimeMs: 1000, tabCount: 1, width: 800, height: 600);

        var evt = Assert.Single(bus.Events);
        Assert.Equal("Motor.StatusMirrored", evt.Name);
        Assert.False(bus.LastPersist, "StatusMirrored must be ring-only (persist:false).");
    }

    [Fact]
    public void Motor_SessionStartFailed_classifies_sidecar_protocol_error()
    {
        var bus = new CapturingBus();
        var emitter = new MotorDiagnosticsEmitter(bus, DevelopmentRuntime());

        emitter.SessionStartFailed(
            new MotorDiagnosticsContext("conn-1", "corr-1", "sess-1", "sc-1"),
            phase: "import_browser_state",
            ex: new SidecarProtocolException("cookie_import_invalid", "bad cookie"),
            severity: DiagnosticsSeverity.Error,
            restored: true, stateLoaded: true, cookieCount: 3);

        var evt = Assert.Single(bus.Events);
        Assert.Equal("Motor.SessionStartFailed", evt.Name);
        var p = Payload(evt);
        Assert.Equal("cookie_import_invalid", p.GetProperty("errorCode").GetString());
        Assert.Equal("import_browser_state", p.GetProperty("phase").GetString());
        Assert.Equal("sess-1", p.GetProperty("persistedSessionId").GetString());
        Assert.Equal(3, p.GetProperty("cookieCount").GetInt32());
    }

    [Fact]
    public void Motor_StateExportFailed_defaults_errorCode_when_not_protocol()
    {
        var bus = new CapturingBus();
        var emitter = new MotorDiagnosticsEmitter(bus, DevelopmentRuntime());

        emitter.StateExportFailed(
            new MotorDiagnosticsContext("conn-1", "corr-1", "sess-1", "sc-1"),
            new InvalidOperationException("boom"));

        var evt = Assert.Single(bus.Events);
        Assert.Equal("Motor.StateExportFailed", evt.Name);
        Assert.Equal(DiagnosticsSeverity.Warning, evt.Severity);
        var p = Payload(evt);
        Assert.Equal("export_failed", p.GetProperty("errorCode").GetString());
        Assert.Equal("export", p.GetProperty("phase").GetString());
    }

    private static MotorDiagnosticsContext Ctx()
        => new("conn-1", "corr-1", "sess-1", "sc-1");

    private static DiagnosticsRuntime DevelopmentRuntime()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(DiagnosticsSeedProfiles.Development());
        return runtime;
    }

    private static DiagnosticsRuntime MetricsOnlyRuntime()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(new DiagnosticsOptions
        {
            Enabled = true,
            Domains = new DiagnosticsDomainsOptions
            {
                Motor = new DiagnosticsMotorOptions { Metrics = true, Events = false, Snapshots = false },
            },
        });
        return runtime;
    }

    private static JsonElement Payload(DiagnosticsEvent evt)
        => JsonDocument.Parse(JsonSerializer.Serialize(evt.Payload)).RootElement;

    private sealed class CapturingBus : IDiagnosticsEventBus
    {
        public List<DiagnosticsEvent> Events { get; } = [];
        public bool LastPersist { get; private set; } = true;
        public void Publish(DiagnosticsEvent diagnosticsEvent, bool persist = true)
        {
            LastPersist = persist;
            Events.Add(diagnosticsEvent);
        }
    }
}
