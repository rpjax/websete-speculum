namespace Speculum.Api.Edge;

public sealed class EdgeWriter : IHostedService
{
    private readonly IEdgeSynchronizer _synchronizer;

    public EdgeWriter(IEdgeSynchronizer synchronizer)
    {
        _synchronizer = synchronizer;
    }

    public Task StartAsync(CancellationToken cancellationToken)
        => _synchronizer.SynchronizeAsync(cancellationToken);

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public void Apply()
        => _synchronizer.SynchronizeAsync().GetAwaiter().GetResult();
}
