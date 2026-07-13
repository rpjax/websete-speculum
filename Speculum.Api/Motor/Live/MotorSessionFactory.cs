using Speculum.Api.Config.Runtime;
using Speculum.Api.Diagnostics.Abstractions;
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
    private readonly IDiagnosticsEventBus        _diagnostics;
    private readonly IDiagnosticsRuntime         _runtime;
    private readonly ILogger<MotorSession>       _logger;

    public MotorSessionFactory(
        SidecarBrowserClientOptions sidecarOptions,
        MotorUrlAdapter             urlAdapter,
        ISidecarClientFactory       sidecarClientFactory,
        IDiagnosticsEventBus        diagnostics,
        IDiagnosticsRuntime         runtime,
        ILogger<MotorSession>       logger)
    {
        _sidecarOptions       = sidecarOptions;
        _urlAdapter           = urlAdapter;
        _sidecarClientFactory = sidecarClientFactory;
        _diagnostics          = diagnostics;
        _runtime              = runtime;
        _logger               = logger;
    }

    public IMotorSession Create(SessionConfigSnapshot snapshot)
        => new MotorSession(
            _sidecarOptions,
            snapshot,
            _urlAdapter,
            _sidecarClientFactory,
            _diagnostics,
            _runtime,
            _logger);
}
