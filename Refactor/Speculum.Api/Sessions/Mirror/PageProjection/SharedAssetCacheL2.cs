using Speculum.Api.Configurations.Services.Contracts;

namespace Speculum.Api.Sessions.Mirror.PageProjection;

/// <summary>
/// Host-wide, credential-less shared asset tier (§5.12.2, E7b). Byte content carrying no
/// session identity is not session state (K2): a public, cookie-less, non-private
/// subresource fetched by one session is deduplicated in memory and served to every other
/// session that requests the identical key. Session state itself — cookies, storage,
/// CSSOM, DOM, id space and any credentialed response — never enters this tier
/// (<see cref="IsShareable"/> gates every write).
/// </summary>
public interface ISharedAssetCacheL2
{
    /// <summary>Kill switch (§5.16 <c>assetCacheL2Enabled</c>); <c>false</c> ⇒ callers must stay L1-only.</summary>
    bool Enabled { get; }

    /// <summary>
    /// Looks up <paramref name="key"/>. Returns a ref-counted handle on hit; the handle's
    /// <see cref="ISharedAssetCacheL2Handle.Body"/> stays valid for its holder even if the
    /// entry is later evicted from the LRU (PP-ASSET-6) — release it when done.
    /// </summary>
    ISharedAssetCacheL2Handle? TryAcquire(string key);

    /// <summary>
    /// Stores <paramref name="body"/> under <paramref name="key"/> and returns a held
    /// reference. A concurrent duplicate write for the same key is coalesced: the existing
    /// entry's reference is returned instead of a second stored copy (PP-ASSET-5).
    /// </summary>
    ISharedAssetCacheL2Handle Put(string key, byte[] body, string contentType, int statusCode = 200);

    /// <summary>Total bytes currently tracked by the LRU (evicted entries are not counted, even if still referenced).</summary>
    long CurrentBytes { get; }

    /// <summary>Entry count currently tracked by the LRU.</summary>
    int Count { get; }
}

/// <summary>A held reference into an L2 entry. Dispose (or let it be garbage collected) to release the reference count.</summary>
public interface ISharedAssetCacheL2Handle : IDisposable
{
    byte[] Body { get; }
    string ContentType { get; }
    int StatusCode { get; }
}

/// <summary>
/// Inputs to the §5.12.2.1 shareability predicate. Callers build this from the origin
/// request/response pair immediately after a fetch, before deciding whether to call
/// <see cref="ISharedAssetCacheL2.Put"/> or keep the body session-local (L1 only).
/// </summary>
public sealed class SharedAssetShareabilityDescriptor
{
    /// <summary>The outgoing request carried a <c>Cookie</c> header.</summary>
    public bool RequestHadCookie { get; init; }

    /// <summary>The outgoing request carried an <c>Authorization</c> header.</summary>
    public bool RequestHadAuthorization { get; init; }

    /// <summary><c>Cache-Control</c> response directives, lower-cased (e.g. <c>private</c>, <c>no-store</c>, <c>no-cache</c>).</summary>
    public IReadOnlyCollection<string> CacheControlDirectives { get; init; } = [];

    /// <summary><c>Vary</c> response header values, as sent (comma-split, untrimmed case preserved for <see cref="VaryValues"/>).</summary>
    public IReadOnlyCollection<string> VaryValues { get; init; } = [];

    /// <summary>HTTP response status code.</summary>
    public int StatusCode { get; init; }

    /// <summary>
    /// Fetch kind. Only <see cref="SharedAssetRequestKind.Subresource"/> is ever shareable —
    /// a navigation document, XHR or <c>fetch()</c> response never enters L2.
    /// </summary>
    public SharedAssetRequestKind Kind { get; init; }
}

public enum SharedAssetRequestKind
{
    Subresource,
    NavigationDocument,
    XhrOrFetch,
}

/// <summary>
/// LRU, byte-capped, reference-counted host-wide L2 cache (§5.12.2). Thread-safe: every
/// public member takes an internal lock, and entries are plain immutable payloads so a
/// held <see cref="ISharedAssetCacheL2Handle"/> stays valid independent of later eviction.
/// </summary>
public sealed class SharedAssetCacheL2 : ISharedAssetCacheL2
{
    private readonly object _gate = new();
    private readonly Dictionary<string, Entry> _byKey = new(StringComparer.Ordinal);
    private readonly LinkedList<Entry> _lru = new(); // head = least recently used, tail = most recently used
    private readonly IConfigurationService _configuration;
    private long _currentBytes;

    public SharedAssetCacheL2(IConfigurationService configuration)
    {
        _configuration = configuration;
    }

    public bool Enabled => _configuration.GetCurrent().Sessions.PageProjection.AssetCacheL2Enabled;

    private long MaxBytes => Math.Max(0, _configuration.GetCurrent().Sessions.PageProjection.AssetCacheL2MaxBytes);

    public long CurrentBytes
    {
        get { lock (_gate) return _currentBytes; }
    }

    public int Count
    {
        get { lock (_gate) return _byKey.Count; }
    }

    public ISharedAssetCacheL2Handle? TryAcquire(string key)
    {
        if (string.IsNullOrEmpty(key))
        {
            return null;
        }

        lock (_gate)
        {
            if (!_byKey.TryGetValue(key, out var entry))
            {
                return null;
            }

            TouchNoLock(entry);
            return AcquireNoLock(entry);
        }
    }

    public ISharedAssetCacheL2Handle Put(string key, byte[] body, string contentType, int statusCode = 200)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        ArgumentNullException.ThrowIfNull(body);

        lock (_gate)
        {
            if (_byKey.TryGetValue(key, out var existing))
            {
                // Coalesce: a concurrent duplicate write keeps the first stored copy (PP-ASSET-5).
                TouchNoLock(existing);
                return AcquireNoLock(existing);
            }

            var entry = new Entry(key, body, contentType, statusCode);
            _byKey[key] = entry;
            entry.LruNode = _lru.AddLast(entry);
            _currentBytes += entry.SizeBytes;
            // Acquire before evicting: the entry just inserted for this caller must never
            // be the one evicted by its own insertion.
            var handle = AcquireNoLock(entry);
            EvictOverCapNoLock();
            return handle;
        }
    }

    private ISharedAssetCacheL2Handle AcquireNoLock(Entry entry)
    {
        entry.RefCount++;
        return new Handle(this, entry);
    }

    private void TouchNoLock(Entry entry)
    {
        if (entry.LruNode is null)
        {
            return; // already evicted from the LRU; nothing to reorder
        }

        _lru.Remove(entry.LruNode);
        entry.LruNode = _lru.AddLast(entry);
    }

    /// <summary>
    /// Evicts least-recently-used entries down to <see cref="MaxBytes"/>. Unreferenced
    /// entries are preferred; if the cap is still exceeded after a full scan (every
    /// remaining entry is held), referenced entries are evicted too — their bytes stop
    /// being tracked, but any held <see cref="ISharedAssetCacheL2Handle"/> keeps its own
    /// reference to the body and is unaffected (PP-ASSET-6).
    /// </summary>
    private void EvictOverCapNoLock()
    {
        var cap = MaxBytes;
        var node = _lru.First;
        while (_currentBytes > cap && node is not null)
        {
            var next = node.Next;
            if (node.Value.RefCount == 0)
            {
                EvictNodeNoLock(node);
            }

            node = next;
        }

        // Second pass: cap still exceeded and everything left is referenced — evict anyway.
        node = _lru.First;
        while (_currentBytes > cap && node is not null)
        {
            var next = node.Next;
            EvictNodeNoLock(node);
            node = next;
        }
    }

    private void EvictNodeNoLock(LinkedListNode<Entry> node)
    {
        _lru.Remove(node);
        node.Value.LruNode = null;
        _byKey.Remove(node.Value.Key);
        _currentBytes -= node.Value.SizeBytes;
    }

    private void ReleaseNoLock(Entry entry)
    {
        entry.RefCount = Math.Max(0, entry.RefCount - 1);
    }

    private sealed class Entry(string key, byte[] body, string contentType, int statusCode)
    {
        public string Key { get; } = key;
        public byte[] Body { get; } = body;
        public string ContentType { get; } = contentType;
        public int StatusCode { get; } = statusCode;
        public long SizeBytes { get; } = body.LongLength;
        public int RefCount;
        public LinkedListNode<Entry>? LruNode;
    }

    private sealed class Handle(SharedAssetCacheL2 owner, Entry entry) : ISharedAssetCacheL2Handle
    {
        private int _disposed;

        public byte[] Body => entry.Body;
        public string ContentType => entry.ContentType;
        public int StatusCode => entry.StatusCode;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0)
            {
                return;
            }

            lock (owner._gate)
            {
                owner.ReleaseNoLock(entry);
            }
        }
    }

    /// <summary>
    /// §5.12.2.1 — an entry may enter L2 only if every condition holds. Errors, credentialed
    /// requests, private/no-store/no-cache responses, `Vary: Cookie|Authorization` and
    /// non-subresource fetches are never shareable (PP-ISO-1, PP-ISO-3).
    /// </summary>
    public static bool IsShareable(SharedAssetShareabilityDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(descriptor);

        if (descriptor.RequestHadCookie || descriptor.RequestHadAuthorization)
        {
            return false;
        }

        if (descriptor.Kind != SharedAssetRequestKind.Subresource)
        {
            return false;
        }

        foreach (var directive in descriptor.CacheControlDirectives)
        {
            var normalized = directive.Trim().ToLowerInvariant();
            if (normalized is "private" or "no-store" or "no-cache")
            {
                return false;
            }
        }

        foreach (var vary in descriptor.VaryValues)
        {
            var normalized = vary.Trim().ToLowerInvariant();
            if (normalized is "cookie" or "authorization" or "*")
            {
                return false;
            }
        }

        return IsCacheableStatus(descriptor.StatusCode);
    }

    /// <summary>Cacheable per HTTP semantics; 4xx/5xx are errors and are never shared (BZ7).</summary>
    private static bool IsCacheableStatus(int statusCode) => statusCode switch
    {
        200 or 203 or 204 or 206 or 300 or 301 or 308 => true,
        _ => false,
    };

    /// <summary>
    /// §5.12.2.1 key — scheme/host/port/path/query after stripping Speculum-reserved
    /// parameters, plus the response's <c>Vary</c> values and the request's credential
    /// mode: a signed CDN URL with a differing query token, or a differently-varying
    /// response for the same URL, must key differently — a miss, never a wrong hit
    /// (PP-ASSET-7).
    /// </summary>
    public static string BuildKey(
        string scheme,
        string host,
        int port,
        string path,
        string strippedQuery,
        IReadOnlyCollection<string> varyValues,
        string credentialMode)
    {
        var vary = varyValues.Count == 0
            ? ""
            : string.Join(',', varyValues.Select(v => v.Trim().ToLowerInvariant()).OrderBy(v => v, StringComparer.Ordinal));
        return $"{scheme}://{host}:{port}{path}{strippedQuery}|vary={vary}|cred={credentialMode}";
    }
}
