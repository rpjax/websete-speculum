using Speculum.Api.Config.Runtime;
using Speculum.Api.Motor.Diagnostics;
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
    private readonly IMotorDiagnosticsEmitter    _diagnostics;
    private readonly ILogger<MotorSession>       _logger;

    public MotorSessionFactory(
        SidecarBrowserClientOptions sidecarOptions,
        MotorUrlAdapter             urlAdapter,
        ISidecarClientFactory       sidecarClientFactory,
        IMotorDiagnosticsEmitter    diagnostics,
        ILogger<MotorSession>       logger)
    {
        _sidecarOptions       = sidecarOptions;
        _urlAdapter           = urlAdapter;
        _sidecarClientFactory = sidecarClientFactory;
        _diagnostics          = diagnostics;
        _logger               = logger;
    }

    public IMotorSession Create(SessionConfigSnapshot snapshot)
        => new MotorSession(
            _sidecarOptions,
            snapshot,
            _urlAdapter,
            _sidecarClientFactory,
            _diagnostics,
            _logger);
}
