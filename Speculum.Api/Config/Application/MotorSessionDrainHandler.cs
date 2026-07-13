using Speculum.Api.Config.Runtime;
using Speculum.Api.Motor.Live;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Config.Application;

public sealed class MotorSessionDrainHandler : IConfigChangeHandler
{
    private readonly IMotorSessionRegistry _sessionRegistry;
    private readonly IBrowserSessionStore _sessionStore;

    public MotorSessionDrainHandler(
        IMotorSessionRegistry sessionRegistry,
        IBrowserSessionStore sessionStore)
    {
        _sessionRegistry = sessionRegistry;
        _sessionStore    = sessionStore;
    }

    public Task HandleAsync(ConfigChangeContext context, CancellationToken ct = default)
    {
        if (context.Phase != ConfigChangePhase.PreReload)
            return Task.CompletedTask;

        if (context.SectionKey is not (ConfigSectionKeys.Forwarding or ConfigSectionKeys.Hosting))
            return Task.CompletedTask;

        return _sessionRegistry.StopAllAsync(_sessionStore, CancellationToken.None);
    }
}
