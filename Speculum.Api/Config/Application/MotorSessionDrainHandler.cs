using Speculum.Api.Config.Runtime;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Motor.Live;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Config.Application;

public sealed class MotorSessionDrainHandler : IConfigChangeHandler
{
    private readonly IMotorSessionRegistry _sessionRegistry;
    private readonly IBrowserSessionStore _sessionStore;
    private readonly IDiagnosticsEventBus _diagnostics;

    public MotorSessionDrainHandler(
        IMotorSessionRegistry sessionRegistry,
        IBrowserSessionStore sessionStore,
        IDiagnosticsEventBus diagnostics)
    {
        _sessionRegistry = sessionRegistry;
        _sessionStore    = sessionStore;
        _diagnostics     = diagnostics;
    }

    public async Task HandleAsync(ConfigChangeContext context, CancellationToken ct = default)
    {
        if (context.Phase != ConfigChangePhase.PreReload)
            return;

        if (context.SectionKey is not (ConfigSectionKeys.Forwarding or ConfigSectionKeys.Hosting))
            return;

        var correlationId = Guid.NewGuid().ToString("N");
        var before = _sessionRegistry.ActiveCount + _sessionRegistry.StartingCount;

        _diagnostics.Publish(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.MotorLive,
            Name = "Motor.DrainStarted",
            CorrelationId = correlationId,
            Payload = new
            {
                sectionKey = context.SectionKey,
                sessionCount = before,
            },
        });

        await _sessionRegistry.StopAllAsync(_sessionStore, CancellationToken.None);

        _diagnostics.Publish(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.MotorLive,
            Name = "Motor.DrainCompleted",
            CorrelationId = correlationId,
            Payload = new
            {
                sectionKey = context.SectionKey,
                sessionCountBefore = before,
                sessionCountAfter = _sessionRegistry.ActiveCount + _sessionRegistry.StartingCount,
            },
        });
    }
}
