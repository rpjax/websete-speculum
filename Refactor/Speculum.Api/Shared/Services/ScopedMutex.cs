using System.Collections.Concurrent;
using Speculum.Api.Shared.Services.Contracts;

namespace Speculum.Api.Shared.Services;

/// <summary>
/// Keyed <see cref="SemaphoreSlim"/> locks with refcounted cleanup.
/// Implements both sync and async acquire over the same gates.
/// </summary>
public sealed class ScopedMutex : IScopedMutex, IAsyncScopedMutex
{
    private readonly ConcurrentDictionary<Guid, Entry> _entries = new();

    public IDisposable Acquire(Guid id, CancellationToken ct = default)
    {
        var entry = Enter(id);
        try
        {
            entry.Semaphore.Wait(ct);
        }
        catch
        {
            ReleaseRef(id, entry, acquired: false);
            throw;
        }

        return new Lease(this, id, entry);
    }

    public async Task<IAsyncDisposable> AcquireAsync(Guid id, CancellationToken ct = default)
    {
        var entry = Enter(id);
        try
        {
            await entry.Semaphore.WaitAsync(ct).ConfigureAwait(false);
        }
        catch
        {
            ReleaseRef(id, entry, acquired: false);
            throw;
        }

        return new Lease(this, id, entry);
    }

    private Entry Enter(Guid id)
    {
        while (true)
        {
            var entry = _entries.GetOrAdd(id, static _ => new Entry());

            lock (entry)
            {
                if (!_entries.TryGetValue(id, out var current) || !ReferenceEquals(current, entry))
                {
                    continue;
                }

                entry.RefCount++;
                return entry;
            }
        }
    }

    private void ReleaseRef(Guid id, Entry entry, bool acquired)
    {
        if (acquired)
        {
            entry.Semaphore.Release();
        }

        lock (entry)
        {
            entry.RefCount--;
            if (entry.RefCount > 0)
            {
                return;
            }

            if (_entries.TryRemove(new KeyValuePair<Guid, Entry>(id, entry)))
            {
                entry.Semaphore.Dispose();
            }
        }
    }

    private sealed class Entry
    {
        public SemaphoreSlim Semaphore { get; } = new(1, 1);
        public int RefCount;
    }

    private sealed class Lease : IDisposable, IAsyncDisposable
    {
        private ScopedMutex? _owner;
        private readonly Guid _id;
        private readonly Entry _entry;

        public Lease(ScopedMutex owner, Guid id, Entry entry)
        {
            _owner = owner;
            _id = id;
            _entry = entry;
        }

        public void Dispose()
        {
            var owner = Interlocked.Exchange(ref _owner, null);
            owner?.ReleaseRef(_id, _entry, acquired: true);
        }

        public ValueTask DisposeAsync()
        {
            Dispose();
            return ValueTask.CompletedTask;
        }
    }
}
