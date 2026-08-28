# Implementation — Asset L2 cache (API)

**Future path:** `Speculum.Api/` virtual-assets serve plane (host-wide shared tier)  
**Suggested type:** `IPageProjectionAssetL2Cache` / `PageProjectionAssetL2Cache`  
**Contracts:** [11-assets.md](../../contracts/11-assets.md), [15-configuration.md](../../contracts/15-configuration.md)  
**Norm:** redesign §5.12.2  
**Tests:** PP-ASSET-4..8, PP-ISO-1..3

---

## Purpose

Host-wide **L2** cache of **shareable public subresource bytes** for PageProjection virtual-assets. Complements per-session **L1**. L1 entries that are shareable hold a **reference** into L2, never a copy. Enforces K2 boundary via a strict shareability predicate.

---

## Invariants

1. L2 admission only when **ALL** predicate clauses hold (PP-ISO-1, PP-ISO-3).
2. Cache key is **never URL alone** (PP-ASSET-7).
3. Errors (4xx/5xx) **never** enter L2 and never cross sessions.
4. Refcount: eviction of L2 storage MUST NOT invalidate a session that still holds a ref (PP-ASSET-6).
5. In-flight coalesce: concurrent same-key fetches across sessions → **one** origin fetch (PP-ASSET-5).
6. Caps: `assetCacheL2MaxBytes` default **1 GiB** LRU; kill switch `assetCacheL2Enabled` (false ⇒ L1-only).
7. Media pass-through (`video/*`, `audio/*`, HLS/DASH) stays **out of L2**.
8. Navigation documents, XHR, and `fetch` API responses never L2.

---

## Bans

- Sharing credentialed / `private` / `no-store` / `no-cache` / `Vary: Cookie|Authorization` responses.
- Keying only on `/w7s/virtual-assets/` path prefix.
- Serving one session’s 404 to another.
- Copying L2 bytes into each L1 when shareable (refcount instead).
- Blocking first paint on L2 fill await-then-404 (PP-ASSET-2 — serve path MUST NOT stall paint; miss degrades element only).

---

## Shareability predicate (normative)

Entry MAY enter L2 iff **all** are true:

1. Request carried **no** `Cookie` and **no** `Authorization`.
2. Response `Cache-Control` does **not** include `private`, `no-store`, or `no-cache`.
3. Response does **not** `Vary` on `Cookie` or `Authorization`.
4. Status is cacheable per HTTP semantics; **errors never shared**.
5. Request is a **subresource** (image, stylesheet, font, script bytes served as asset, etc.) — **not** navigation document, XHR, or `fetch` API response.
6. Content-type not in media pass-through set (or explicitly classified non-media).

Anything failing stays L1-only.

---

## Cache key

```
L2Key = (
  scheme,
  host,
  port,
  path,
  queryMinusSpeculumReserved,  // strip Speculum-reserved params only
  varyHeaderValues,            // values of every request header named in response Vary
  credentialMode               // e.g. omit / include — must be omit for L2
)
```

Signed CDN URLs with differing tokens ⇒ different keys ⇒ correct miss (PP-ASSET-7).

Serve URL forms (rewrite correctness peer):

- `/w7s/virtual-assets/{host}{path}?query`
- `/w7s/virtual-blob/{id}`
- `/w7s/virtual-data/{id}`

Serve lookup key = `host/path?query` after stripping reserved params — never key solely on the `/w7s/virtual-assets/` prefix.

---

## Signatures (C#)

```csharp
public readonly record struct AssetL2Key(
    string Scheme,
    string Host,
    int Port,
    string Path,
    string QueryCanonical,
    string VaryFingerprint,
    string CredentialMode);

public sealed class AssetL2Entry
{
    public required AssetL2Key Key { get; init; }
    public required int StatusCode { get; init; }
    public required string? ContentType { get; init; }
    public required byte[] Bytes { get; init; }           // or blob store handle
    public string? ETag { get; init; }
    public DateTimeOffset? LastModified { get; init; }
    public long ByteLength => Bytes.LongLength;
}

public interface IPageProjectionAssetL2Cache
{
    bool Enabled { get; }

    /// <summary>Try get; bumps LRU; does not change refcount.</summary>
    bool TryGet(AssetL2Key key, out AssetL2Entry? entry);

    /// <summary>Session acquires a ref after L1 decides content is shareable.</summary>
    IAssetL2Lease Lease(AssetL2Key key, AssetL2Entry entry);

    /// <summary>
    /// Coalesced fill: join in-flight or start origin fetch; only inserts if predicate holds.
    /// </summary>
    Task<AssetL2LookupResult> GetOrCoalesceAsync(
        AssetL2Key key,
        AssetL2RequestMeta meta,
        Func<CancellationToken, Task<AssetOriginResponse>> fetchOrigin,
        CancellationToken ct);

    void SetCapacityBytes(long maxBytes);
}

public interface IAssetL2Lease : IDisposable
{
    AssetL2Entry Entry { get; }
}

public sealed class AssetL2RequestMeta
{
    public bool RequestHadCookie { get; init; }
    public bool RequestHadAuthorization { get; init; }
    public bool IsSubresource { get; init; }
    public bool IsMediaPassThrough { get; init; }
    public string CredentialMode { get; init; } = "omit";
}

public sealed class AssetOriginResponse
{
    public int StatusCode { get; init; }
    public string? CacheControl { get; init; }
    public string? Vary { get; init; }
    public string? ContentType { get; init; }
    public string? ETag { get; init; }
    public DateTimeOffset? LastModified { get; init; }
    public byte[] Body { get; init; } = Array.Empty<byte>();
}
```

---

## Algorithm — predicate check

```
CanEnterL2(meta, response):
  if !Enabled → false
  if meta.RequestHadCookie || meta.RequestHadAuthorization → false
  if meta.CredentialMode != omit → false
  if !meta.IsSubresource → false
  if meta.IsMediaPassThrough → false
  if response.StatusCode is error or non-cacheable → false
  if CacheControl has private|no-store|no-cache → false
  if Vary names Cookie or Authorization → false
  return true
```

---

## Algorithm — coalesce + insert

```
GetOrCoalesceAsync(key, meta, fetchOrigin):
  if TryGet(key, out e): return Hit(e)
  if inFlight.TryGet(key, out task): return await task   // cross-session join
  task = RunFill(...)
  inFlight[key] = task
  try return await task
  finally inFlight.Remove(key)

RunFill:
  origin = await fetchOrigin()
  if !CanEnterL2(meta, origin): return NotShareable(origin)  // caller stores L1 only
  entry = new Entry(...)
  InsertLru(entry)  // may evict zero-ref entries until under cap
  return Stored(entry)
```

---

## Algorithm — refcount + LRU eviction

```
each entry: refCount, lruNode, byteLength

Lease(entry):
  refCount++
  return lease whose Dispose → refCount--

EvictWhileOverCap:
  while totalBytes > maxBytes:
    candidate = LRU oldest with refCount == 0
    if none: stop (over cap temporarily while refs held — OK; MUST NOT drop ref>0)
    remove candidate; totalBytes -= length
```

Revalidation: honour ETag / Last-Modified; **304 ≠ empty body** — keep prior bytes.

---

## Coupling with L1

- L1 (per session) is authoritative for the session including private bytes.
- Shareable L1 slot stores `IAssetL2Lease` (or key+lease), not duplicated arrays.
- L1 LRU cap `assetCacheL1MaxBytes` = 8 MiB (config) — separate module/spec; this file is L2-only.

Priority of fetch (CSS / in-viewport first) is sidecar/client-driven (PP-ASSET-1); L2 does not reorder.

---

## Tests

| ID | Assert |
|----|--------|
| `PP-ASSET-5` | Two sessions same public asset → one origin fetch, one stored copy |
| `PP-ASSET-6` | L2 over cap evicts; leased entry remains valid for holder |
| `PP-ASSET-7` | Differing signed query tokens → miss |
| `PP-ASSET-8` | Warm L2: session N P1 ≥ session 1 (oracle / harness) |
| `PP-ISO-1` | Cookie/Auth/private/no-store/Vary Cookie never in L2 |
| `PP-ISO-2` | No cross-session DOM/CSSOM/id/credentialed bleed via L2 |
| `PP-ISO-3` | 404 from session A never served to B |
| Kill switch | `assetCacheL2Enabled=false` → never insert |
