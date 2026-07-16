using Speculum.Api.Config.Runtime;
using Speculum.Api.Motor.Diagnostics;
using Speculum.Api.Motor.Mapping;
using Speculum.Api.Motor.Sidecar;

namespace Speculum.Api.Motor.Live;

public interface IMotorSessionFactory
{
    /// <summary>
    /// Creates a session bound to the already-context-bound producer handle. The coordinator
    /// hands in the handle so the whole startup narrative shares one correlation lineage.
    /// </summary>
    IMotorSession Create(SessionConfigSnapshot snapshot, IMotorEvents events);
}

public sealed class MotorSessionFactory : IMotorSessionFactory
{
    private readonly SidecarBrowserClientOptions _sidecarOptions;
    private readonly MotorUrlAdapter             _urlAdapter;
    private readonly ISidecarClientFactory       _sidecarClientFactory;
    private readonly ILogger<MotorSession>       _logger;

    public MotorSessionFactory(
        SidecarBrowserClientOptions sidecarOptions,
        MotorUrlAdapter             urlAdapter,
        ISidecarClientFactory       sidecarClientFactory,
        ILogger<MotorSession>       logger)
    {
        _sidecarOptions       = sidecarOptions;
        _urlAdapter           = urlAdapter;
        _sidecarClientFactory = sidecarClientFactory;
        _logger               = logger;
    }

    public IMotorSession Create(SessionConfigSnapshot snapshot, IMotorEvents events)
        => new MotorSession(
            _sidecarOptions,
            snapshot,
            _urlAdapter,
            _sidecarClientFactory,
            events,
            _logger);
}
