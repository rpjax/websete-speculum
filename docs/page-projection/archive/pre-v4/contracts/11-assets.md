# Contract 11 — Assets

**Norm:** redesign §5.12. **Tests:** PP-ASSET-1..8, PP-ISO-1..3. **Impl:** API `assets-l2.md`, sidecar rewrite/prefetch notes in `node-rewrite.md`.

## Serving rules

1. **Priority:** CSS and in-viewport images first; below-fold/decorative deferred. Margin `assetPriorityViewportPx` (200) — PP-ASSET-1.  
2. **No blocking await** on paint path; slow asset degrades that element only — PP-ASSET-2.  
3. Honour upstream cache headers within session.  
4. Coalesce duplicate in-flight requests (session + cross-session for L2 keys).  
5. Rewrite correctness: no `virtualData1x1` placeholder abuse, no bare-root 400, no CDN paths without public id — PP-ASSET-3.

## URL forms

- `/w7s/virtual-assets/{host}{path}?query`  
- `/w7s/virtual-blob/{id}`  
- `/w7s/virtual-data/{id}`  

Serve key = `host/path?query` after stripping Speculum-reserved params (never key on the `/w7s/virtual-assets/` prefix alone incorrectly).

## Two-tier cache

| Tier | Scope | Contents |
|------|-------|----------|
| L1 | Per session | All fetched; authoritative for session |
| L2 | Host-wide | Shareable public bytes only; refcounted |

L1 shareable entries reference L2, never copy.

### L2 predicate (ALL required) — PP-ISO-1, PP-ISO-3

- No request `Cookie` / `Authorization`  
- Response not `Cache-Control: private|no-store|no-cache`  
- No `Vary: Cookie|Authorization`  
- Cacheable status; **errors never shared**  
- Subresource only — never navigation document, XHR, or `fetch` API response  

### Key

scheme, host, port, path, query (minus Speculum-reserved), Vary header values, credential mode. **Never URL alone** — PP-ASSET-7.

### Other

- Revalidation: ETag / Last-Modified; 304 ≠ empty body.  
- In-flight coalesce across sessions — PP-ASSET-5.  
- Media pass-through out of L2.  
- Caps: L1 `assetCacheL1MaxBytes` 8 MiB; L2 `assetCacheL2MaxBytes` 1 GiB LRU; kill switch `assetCacheL2Enabled` — PP-ASSET-4, PP-ASSET-6.  
- L2 eviction while session holds ref MUST NOT invalidate session view.

## K2

Credentialed / private / session DOM/CSSOM/id space never cross sessions — PP-ISO-2.
