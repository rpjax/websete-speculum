using System.Threading.Channels;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// Bounded video-streaming input admission with HF-first eviction and backpressure to the
/// downstream pump (pipe capacity 1 blocks when gRPC is slow).
/// </summary>
internal sealed class VideoStreamingInputAdmissionChannel : IDisposable
{
    public const int DefaultCapacity = 64;

    private readonly Queue<VideoStreamingInput> _queue = new();
    private readonly int _capacity;
    private readonly object _gate = new();
    private readonly Channel<VideoStreamingInput> _pipe;
    private readonly CancellationTokenSource _cts = new();
    private readonly SemaphoreSlim _signal = new(0);
    private readonly Task _pump;
    private int _disposed;

    public static VideoStreamingInputAdmissionChannel Create(int capacity = DefaultCapacity)
        => new(capacity, enablePump: true);

    /// <summary>Test seam: queue-only (no async pump) so eviction can be asserted without races.</summary>
    internal static VideoStreamingInputAdmissionChannel CreateQueueOnly(int capacity)
        => new(capacity, enablePump: false);

    internal VideoStreamingInput[] SnapshotQueueForTests()
    {
        lock (_gate)
        {
            return _queue.ToArray();
        }
    }

    private VideoStreamingInputAdmissionChannel(int capacity, bool enablePump)
    {
        _capacity = capacity;
        _pipe = Channel.CreateBounded<VideoStreamingInput>(new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
            SingleWriter = true,
        });
        _pump = enablePump ? PumpAsync(_cts.Token) : Task.CompletedTask;
    }

    public ChannelReader<VideoStreamingInput> Reader => _pipe.Reader;

    public void Admit(VideoStreamingInput input)
    {
        ObjectDisposedException.ThrowIf(_disposed != 0, this);
        lock (_gate)
        {
            EnqueueWithEviction(input);
        }

        _signal.Release();
    }

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

    private void EnqueueWithEviction(VideoStreamingInput input)
    {
        while (_queue.Count >= _capacity)
        {
            if (VideoStreamingInputAdmitPolicy.IsHighFrequency(input) && TryEvictHighFrequency())
            {
                continue;
            }

            if (!VideoStreamingInputAdmitPolicy.IsHighFrequency(input) && TryEvictHighFrequency())
            {
                continue;
            }

            _queue.Dequeue();
        }

        _queue.Enqueue(input);
    }

    private bool TryEvictHighFrequency()
    {
        if (_queue.Count == 0)
        {
            return false;
        }

        var items = _queue.ToArray();
        for (var i = 0; i < items.Length; i++)
        {
            if (!VideoStreamingInputAdmitPolicy.IsHighFrequency(items[i]))
            {
                continue;
            }

            _queue.Clear();
            for (var j = 0; j < items.Length; j++)
            {
                if (j != i)
                {
                    _queue.Enqueue(items[j]);
                }
            }

            return true;
        }

        return false;
    }

    private async Task PumpAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await _signal.WaitAsync(ct).ConfigureAwait(false);
                while (true)
                {
                    VideoStreamingInput? item;
                    lock (_gate)
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
