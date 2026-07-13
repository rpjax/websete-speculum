using Speculum.Api.Config.Runtime;
using Speculum.Api.Motor.Mapping;
using Speculum.Api.Motor.Sidecar;

namespace Speculum.Api.Motor.Live;

public interface IMotorSessionFactory
{
    IMotorSession Create(SessionConfigSnapshot snapshot);
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

    public IMotorSession Create(SessionConfigSnapshot snapshot)
        => new MotorSession(
            _sidecarOptions,
            snapshot,
            _urlAdapter,
            _sidecarClientFactory,
            _logger);
}
