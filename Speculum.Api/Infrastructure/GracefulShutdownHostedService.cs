using Speculum.Api.Motor.Live;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Infrastructure;

public sealed class GracefulShutdownHostedService : IHostedService
{
    private readonly IMotorSessionRegistry   _registry;
    private readonly IBrowserSessionStore    _sessionStore;
    private readonly IHostApplicationLifetime _lifetime;
    private readonly ILogger<GracefulShutdownHostedService> _logger;

    public GracefulShutdownHostedService(
        IMotorSessionRegistry registry,
        IBrowserSessionStore sessionStore,
        IHostApplicationLifetime lifetime,
        ILogger<GracefulShutdownHostedService> logger)
    {
        _registry     = registry;
        _sessionStore = sessionStore;
        _lifetime     = lifetime;
        _logger       = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _lifetime.ApplicationStopping.Register(() =>
        {
            try
            {
                _logger.LogInformation("Application stopping — capturing browser state and draining sessions.");
                _registry.StopAllAsync(_sessionStore, _lifetime.ApplicationStopping).GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during graceful shutdown.");
            }
        });

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
