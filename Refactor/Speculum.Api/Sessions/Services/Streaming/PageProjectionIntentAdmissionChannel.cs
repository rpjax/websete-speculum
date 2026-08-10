using System.Threading.Channels;
using Speculum.Api.Sessions.Mirror.PageProjection;

namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// Bounded PageProjection intent admission.
/// Under pressure (§6.4): evict coalescable moves; collapse scroll to latest per
/// scroller; never drop presses / keys / scroll / files / focus.
/// </summary>
internal sealed class PageProjectionIntentAdmissionChannel : IDisposable
{
    public const int DefaultCapacity = 64;

    private readonly Queue<PageProjectionIntent> _queue = new();
    private readonly int _capacity;
    private readonly Channel<PageProjectionIntent> _pipe;
    private readonly CancellationTokenSource _cts = new();
    private readonly SemaphoreSlim _signal = new(0);
    private readonly Task _pump;
    private int _disposed;

    public static PageProjectionIntentAdmissionChannel Create(int capacity = DefaultCapacity)
        => new(capacity, enablePump: true);

    /// <summary>Test helper — queue only, no drain pump.</summary>
    internal static PageProjectionIntentAdmissionChannel CreateQueueOnly(int capacity)
        => new(capacity, enablePump: false);

    private PageProjectionIntentAdmissionChannel(int capacity, bool enablePump)
    {
        _capacity = capacity;
        _pipe = Channel.CreateBounded<PageProjectionIntent>(new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
            SingleWriter = true,
        });
        _pump = enablePump ? PumpAsync(_cts.Token) : Task.CompletedTask;
    }

    public ChannelReader<PageProjectionIntent> Reader => _pipe.Reader;

    public void Admit(PageProjectionIntent input, out PageProjectionIntent? dropped)
    {
        ObjectDisposedException.ThrowIf(_disposed != 0, this);
        dropped = null;
        lock (_queue)
        {
            while (_queue.Count >= _capacity)
            {
                if (TryEvictDroppable(out var evicted))
                {
                    dropped = evicted;
                    break;
                }

                if (TryCollapseScroll(input, out var collapsed))
                {
                    dropped = collapsed;
                    break;
                }

                if (IsDroppable(input.Type))
                {
                    // Queue is only protected intents — drop the incoming move.
                    dropped = input;
                    return;
                }

                // Soft over-capacity for protected-only pressure (§6.4 hard rule).
                break;
            }

            if (IsScroll(input.Type))
            {
                CollapseMatchingScrollInQueue(input, ref dropped);
            }

            _queue.Enqueue(input);
        }

        _signal.Release();
    }

    /// <summary>Admit without observing DropOldest eviction (tests / callers that ignore drops).</summary>
    public void Admit(PageProjectionIntent input) => Admit(input, out _);

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

    /// <summary>
    /// Coalescable under load (input §6.4). Everything else is protected.
    /// </summary>
    internal static bool IsDroppable(string? type)
    {
        var t = (type ?? string.Empty).Trim();
        return t is "mousemove" or "pointermove";
    }

    internal static bool IsScroll(string? type)
    {
        var t = (type ?? string.Empty).Trim();
        return t is "scrollViewport" or "scrollElement";
    }

    private static string ScrollKey(PageProjectionIntent intent)
    {
        var t = (intent.Type ?? string.Empty).Trim();
        if (t == "scrollViewport") return "viewport";
        return "element:" + (intent.Anchor ?? string.Empty).Trim();
    }

    private bool TryCollapseScroll(PageProjectionIntent incoming, out PageProjectionIntent? collapsed)
    {
        collapsed = null;
        if (!IsScroll(incoming.Type)) return false;
        return CollapseMatchingScrollInQueue(incoming, ref collapsed);
    }

    private bool CollapseMatchingScrollInQueue(PageProjectionIntent incoming, ref PageProjectionIntent? collapsed)
    {
        if (!IsScroll(incoming.Type)) return false;
        var key = ScrollKey(incoming);
        var kept = new Queue<PageProjectionIntent>(_queue.Count);
        PageProjectionIntent? found = null;
        while (_queue.Count > 0)
        {
            var item = _queue.Dequeue();
            if (found is null && IsScroll(item.Type) && ScrollKey(item) == key)
            {
                found = item;
                continue;
            }

            kept.Enqueue(item);
        }

        while (kept.Count > 0)
        {
            _queue.Enqueue(kept.Dequeue());
        }

        if (found is not null)
        {
            collapsed = found;
            return true;
        }

        return false;
    }

    private bool TryEvictDroppable(out PageProjectionIntent? evicted)
    {
        // Prefer oldest droppable so newer moves stay (collapse-to-latest effect).
        var kept = new Queue<PageProjectionIntent>(_queue.Count);
        PageProjectionIntent? found = null;
        while (_queue.Count > 0)
        {
            var item = _queue.Dequeue();
            if (found is null && IsDroppable(item.Type))
            {
                found = item;
                continue;
            }

            kept.Enqueue(item);
        }

        while (kept.Count > 0)
        {
            _queue.Enqueue(kept.Dequeue());
        }

        evicted = found;
        return found is not null;
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
                    PageProjectionIntent? item;
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
