using Microsoft.Extensions.Hosting;

namespace Speculum.Api.Journal.Tests;

internal sealed class FakeHostApplicationLifetime : IHostApplicationLifetime
{
    private readonly CancellationTokenSource _started = new();
    private readonly CancellationTokenSource _stopping = new();
    private readonly CancellationTokenSource _stopped = new();

    public CancellationToken ApplicationStarted => _started.Token;
    public CancellationToken ApplicationStopping => _stopping.Token;
    public CancellationToken ApplicationStopped => _stopped.Token;

    public int StopCount { get; private set; }

    public void StopApplication()
    {
        StopCount++;
        _stopping.Cancel();
        _stopped.Cancel();
    }
}
