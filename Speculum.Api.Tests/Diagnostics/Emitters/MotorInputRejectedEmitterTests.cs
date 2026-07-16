using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Emitters;
using Speculum.Api.Diagnostics.Pipeline;
using Speculum.Api.Motor.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

namespace Speculum.Api.Tests.Diagnostics.Emitters;

public sealed class MotorInputRejectedEmitterTests
{
    [Fact]
    public void InputRejected_publishes_errorCode_and_phase()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(DiagnosticsSeedProfiles.Development());
        var sink = new RecordingSink();
        var ring = new SessionEventRing();
        DiagnosticsEventBus? bus = null;
        var self = new Lazy<IDiagnosticsSelfEmitter>(() => new DiagnosticsSelfEmitter(bus!));
        var spans = new SpanTracker(new Lazy<IDiagnosticsEventBus>(() => bus!));
        bus = new DiagnosticsEventBus(runtime, [sink], ring, self, spans, NullLogger<DiagnosticsEventBus>.Instance);

        var events = new MotorEvents(bus, runtime, spans, "conn-1", "corr-1", session: null);
        events.InputRejected("blocked input type 'paste'", "paste");

        var ev = Assert.Single(sink.Events, e => e.Name == "Motor.InputRejected");
        Assert.Equal(DiagnosticsSeverity.Warning, ev.Severity);
        var payload = Assert.IsType<MotorInputRejectedPayload>(ev.Payload);
        Assert.Equal("input_blocked", payload.ErrorCode);
        Assert.Equal("validate", payload.Phase);
        Assert.Equal("paste", payload.InputType);
        Assert.Contains("paste", payload.Message, StringComparison.Ordinal);
    }

    private sealed class RecordingSink : IDiagnosticsSink
    {
        public List<DiagnosticsEvent> Events { get; } = [];
        public ValueTask WriteAsync(DiagnosticsEvent diagnosticsEvent, CancellationToken ct = default)
        {
            Events.Add(diagnosticsEvent);
            return ValueTask.CompletedTask;
        }
    }
}
