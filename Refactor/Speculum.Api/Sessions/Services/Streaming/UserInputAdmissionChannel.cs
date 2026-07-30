using System.Threading.Channels;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// Bounded user-input admission with HF-first eviction and backpressure to the
/// downstream pump (pipe capacity 1 blocks when gRPC is slow).
/// </summary>
internal sealed class UserInputAdmissionChannel : IDisposable
{
    public const int DefaultCapacity = 64;

    private readonly Queue<UserInput> _queue = new();
    private readonly int _capacity;
    private readonly object _gate = new();
    private readonly Channel<UserInput> _pipe;
    private readonly CancellationTokenSource _cts = new();
    private readonly SemaphoreSlim _signal = new(0);
    private readonly Task _pump;
    private int _disposed;

    private UserInputAdmissionChannel(int capacity)
    {
        _capacity = capacity;
        _pipe = Channel.CreateBounded<UserInput>(new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
            SingleWriter = true,
        });
        _pump = PumpAsync(_cts.Token);
    }

    public ChannelReader<UserInput> Reader => _pipe.Reader;

    public static UserInputAdmissionChannel Create(int capacity = DefaultCapacity)
        => new(capacity);

    public void Admit(UserInput input)
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

    private void EnqueueWithEviction(UserInput input)
    {
        while (_queue.Count >= _capacity)
        {
            if (UserInputAdmitPolicy.IsHighFrequency(input) && TryEvictHighFrequency())
            {
                continue;
            }

            if (!UserInputAdmitPolicy.IsHighFrequency(input) && TryEvictHighFrequency())
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
            if (!UserInputAdmitPolicy.IsHighFrequency(items[i]))
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
                    UserInput? item;
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
