using System.Threading.Channels;
using Speculum.Api.Sessions.Mirror.DomProjection;

namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// Bounded Dom Projection input admission with DropOldest eviction.
/// </summary>
internal sealed class DomProjectionInputAdmissionChannel : IDisposable
{
    public const int DefaultCapacity = 64;

    private readonly Queue<DomProjectionInput> _queue = new();
    private readonly int _capacity;
    private readonly Channel<DomProjectionInput> _pipe;
    private readonly CancellationTokenSource _cts = new();
    private readonly SemaphoreSlim _signal = new(0);
    private readonly Task _pump;
    private int _disposed;

    public static DomProjectionInputAdmissionChannel Create(int capacity = DefaultCapacity)
        => new(capacity, enablePump: true);

    /// <summary>Test helper — queue only, no drain pump.</summary>
    internal static DomProjectionInputAdmissionChannel CreateQueueOnly(int capacity)
        => new(capacity, enablePump: false);

    private DomProjectionInputAdmissionChannel(int capacity, bool enablePump)
    {
        _capacity = capacity;
        _pipe = Channel.CreateBounded<DomProjectionInput>(new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
            SingleWriter = true,
        });
        _pump = enablePump ? PumpAsync(_cts.Token) : Task.CompletedTask;
    }

    public ChannelReader<DomProjectionInput> Reader => _pipe.Reader;

    public void Admit(DomProjectionInput input, out DomProjectionInput? dropped)
    {
        ObjectDisposedException.ThrowIf(_disposed != 0, this);
        dropped = null;
        lock (_queue)
        {
            while (_queue.Count >= _capacity)
            {
                dropped = _queue.Dequeue();
            }

            _queue.Enqueue(input);
        }

        _signal.Release();
    }

    /// <summary>Admit without observing DropOldest eviction (tests / callers that ignore drops).</summary>
    public void Admit(DomProjectionInput input) => Admit(input, out _);

    public void Complete()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _cts.Cancel();
        _pipe.Writer.TryComplete();
        _signal.Release();
    }

    public void Dispose() => Complete();

    private async Task PumpAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await _signal.WaitAsync(ct).ConfigureAwait(false);
                while (true)
                {
                    DomProjectionInput? item;
                    lock (_queue)
                    {
                        if (_queue.Count == 0)
                        {
                            break;
                        }

                        item = _queue.Dequeue();
                    }

                    await _pipe.Writer.WriteAsync(item, ct).ConfigureAwait(false);
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
        }
        catch (ChannelClosedException)
        {
        }
    }
}
