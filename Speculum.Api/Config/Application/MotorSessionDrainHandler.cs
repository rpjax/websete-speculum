using Speculum.Api.Config.Runtime;
using Speculum.Api.Motor.Diagnostics;
using Speculum.Api.Motor.Live;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Config.Application;

public sealed class MotorSessionDrainHandler : IConfigChangeHandler
{
    private readonly IMotorSessionRegistry _sessionRegistry;
    private readonly IBrowserSessionStore _sessionStore;
    private readonly IMotorEventsFactory _events;

    public MotorSessionDrainHandler(
        IMotorSessionRegistry sessionRegistry,
        IBrowserSessionStore sessionStore,
        IMotorEventsFactory events)
    {
        _sessionRegistry = sessionRegistry;
        _sessionStore    = sessionStore;
        _events          = events;
    }

    public async Task HandleAsync(ConfigChangeContext context, CancellationToken ct = default)
    {
        if (context.Phase != ConfigChangePhase.PreReload)
            return;

        if (context.SectionKey is not (ConfigSectionKeys.Forwarding or ConfigSectionKeys.Hosting))
            return;

        var correlationId = Guid.NewGuid().ToString("N");
        var before = _sessionRegistry.ActiveCount + _sessionRegistry.StartingCount;

        var events = _events.BeginGlobal(correlationId);
        events.DrainStarted(context.SectionKey, before);

        await _sessionRegistry.StopAllAsync(
            _sessionStore, CancellationToken.None, correlationId);

        events.DrainCompleted(
            context.SectionKey,
            before,
            _sessionRegistry.ActiveCount + _sessionRegistry.StartingCount);
    }
}
