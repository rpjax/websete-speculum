using Websete.Speculum.Host.Virtualization.Contracts;
using Websete.Speculum.Host.Virtualization.Persistence;

namespace Websete.Speculum.Host.Hosting;

public sealed class GracefulShutdownHostedService : IHostedService
{
    private readonly IVSessionRegistry       _registry;
    private readonly IProfileSnapshotMerger _merger;
    private readonly IHostApplicationLifetime _lifetime;
    private readonly ILogger<GracefulShutdownHostedService> _logger;

    public GracefulShutdownHostedService(
        IVSessionRegistry registry,
        IProfileSnapshotMerger merger,
        IHostApplicationLifetime lifetime,
        ILogger<GracefulShutdownHostedService> logger)
    {
        _registry = registry;
        _merger   = merger;
        _lifetime = lifetime;
        _logger   = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _lifetime.ApplicationStopping.Register(() =>
        {
            try
            {
                _logger.LogInformation("Application stopping — capturing snapshots and draining sessions.");
                _registry.StopAllAsync(_merger, _lifetime.ApplicationStopping).GetAwaiter().GetResult();
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
