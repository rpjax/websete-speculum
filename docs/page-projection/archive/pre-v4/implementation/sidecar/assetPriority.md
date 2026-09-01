# Implementation — Asset prefetch priority

| Field | Value |
|-------|-------|
| **Future path** | `sidecar/browser/patchright/mirror/page/assetPriority.ts` (≤200 LOC) + hooks from rewrite/mirror |
| **LOC ceiling** | 200 |
| **Contracts** | [11-assets.md](../../contracts/11-assets.md) § priority |
| **Invariants** | CSS and in-viewport images fetched ahead of below-fold/decorative. Margin = `assetPriorityViewportPx` (default 200). Never block establish paint on asset await. |
| **Ban list** | Stubbing all non-CSS as equal priority. Blocking first paint on cache fill. Fabricating L2-shareable credentials. |

## Algorithm

1. When Node rewrite emits a virtual-asset URL for `link[rel=stylesheet]` / CSS `url()` / `@import` → enqueue priority **0** (highest).  
2. When rewrite emits image-like URL (`img`, `srcset`, `poster`, css image):  
   - If producer annotated `inViewportHint` OR client later reports intersection: priority **1**.  
   - Else priority **2** (below-fold).  
3. Decorative / tracking heuristics MAY demote to priority **3** only when clearly non-content (optional; default leave at 2).  
4. Drain queue: all priority 0, then 1, then 2…; coalesce duplicate URLs.  
5. Fetch MUST NOT await on the establish critical path; fire-and-forget into L1/L2 serve plane.  
6. Distance: if Virtual geometry available at rewrite time, `distancePx = min distance of element box to viewport expanded by assetPriorityViewportPx`; `distancePx <= 0` ⇒ priority 1.

## Signatures

```ts
type AssetPriority = 0 | 1 | 2 | 3;
interface PrefetchItem { urlKey: string; priority: AssetPriority; isCss: boolean }
interface AssetPrefetcher {
  enqueue(item: PrefetchItem): void;
  // drained by session host; never blocks encode/establish
}
```

## Tests

PP-ASSET-1, PP-ASSET-2.
