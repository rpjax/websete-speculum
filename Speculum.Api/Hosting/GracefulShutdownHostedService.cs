using Speculum.Api.Virtualization.Contracts;
using Speculum.Api.Virtualization.Persistence;

namespace Speculum.Api.Hosting;

public sealed class GracefulShutdownHostedService : IHostedService
{
    private readonly IVSessionRegistry       _registry;
    private readonly IBrowserSessionStore    _sessionStore;
    private readonly IHostApplicationLifetime _lifetime;
    private readonly ILogger<GracefulShutdownHostedService> _logger;

    public GracefulShutdownHostedService(
        IVSessionRegistry registry,
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
