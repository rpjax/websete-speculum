# Implementation — `registry.ts` (web)

**Future path:** `Refactor/web/src/features/sessions/live/page/registry.ts`  
**LOC ceiling:** 150  
**Contracts:** [09-apply.md](../../contracts/09-apply.md), [05-establish.md](../../contracts/05-establish.md)  
**Decisions:** D-SPEC-4 (checksum), D-SPEC-0 (redesign-only source)  
**Norm:** redesign §5.6.4, §5.9.1.4  
**Orchestration caller:** [ProjectionClient.md](ProjectionClient.md) — this module owns map + establish verify only.

---

## Purpose

O(1) address space for the Projected document: `Map<u32, Node>`. Live apply resolves **only** through this map. Establish/resync bootstrap walks `speculum-anchor` **once** after chunked HTML parse, then verifies `nodeCount` + `checksum` against `establishEnd`.

---

## Invariants

1. `get(id)` is O(1); live apply MUST NOT call `querySelector` / `querySelectorAll` for identity correctness (attribute MAY remain on nodes after establish).
2. Register on construct; unregister on remove including **all** descendants (`deleteSubtree`).
3. Id `0` (`NONE`) is never registered; `get(0)` always `undefined`.
4. `buildFromDocument` walks the **active** surface document (or the buffer document under construction) in **document order** and uses the same mix order as the producer checksum (D-SPEC-4).
5. Checksum mismatch or `nodeCount` mismatch ⇒ caller desyncs (`establish_checksum_mismatch` / `establish_node_count_mismatch`); registry MUST NOT silently accept.
6. On buffer retire / generation clear: `clear()` drops every entry; no leaked WeakRefs or orphan maps.

---

## Bans

- Live resolve via `querySelector('[speculum-anchor="…"]')` or any CSS identity scan.
- Partial registry after checksum fail (leave map half-built).
- Calling `document.normalize()` during or after walk (PP-F-2).
- Reusing registry across double-buffer epochs without `clear()`.
- Soft-skip missing anchors or mismatched counts.

---

## Types and signatures

```ts
/** uint32 wire id; 0 is NEVER a registered node. */
export type NodeId = number;

export type BuildFromDocumentResult = {
  nodeCount: number;
  checksum: number; // u32
};

export interface Registry {
  get(id: NodeId): Node | undefined;
  set(id: NodeId, node: Node): void;
  /** Unregister `id` and every descendant currently reachable under it in the live tree. */
  deleteSubtree(id: NodeId): void;
  /**
   * Walk `doc` once: every node with attribute `speculum-anchor` (elements, and
   * text/comment hosts that carry the attribute per F establish HTML).
   * Returns counts + FNV-1a checksum matching producer (D-SPEC-4).
   */
  buildFromDocument(doc: Document): BuildFromDocumentResult;
  clear(): void;
  /** Debug / O2 cheap path — current registered element+text+comment count. */
  size(): number;
}

export function createRegistry(): Registry;
```

---

## Algorithm — `set` / `get` / `deleteSubtree`

### `set(id, node)`

1. If `id === 0` → throw (programming error; never wire-valid for registry keys of Dom nodes).
2. `map.set(id, node)`.
3. Optionally stamp `node` with `speculum-anchor="${id}"` only when the node was constructed from a live `fresh` ChildRef and the surface already uses anchors for debug — **not required for live correctness**. Prefer: establish HTML already carried anchors; live `fresh` nodes MAY omit the attribute.

### `get(id)`

1. If `id === 0` → `undefined`.
2. Return `map.get(id)`.

### `deleteSubtree(id)`

1. `const root = map.get(id)`; if missing → no-op (caller ACID path already failed earlier) **or** treat as programming error if invoked after successful resolve — prefer no-op only when orchestrator already desynced.
2. Depth-first (or TreeWalker) from `root`: for every node that has a registered id (via map reverse optional, or attribute, or side table), `map.delete(id)`.
3. Prefer a **side reverse** only if needed for nodes without attributes; within 150 LOC, use: walk DOM subtree; for each node, if `speculum-anchor` present parse id and delete; **additionally** maintain no second index unless required — budget: single `Map<u32, Node>` + walk by DOM for unregister.
4. After unregister, caller removes `root` from its parent (applyDom owns DOM mutation).

**Unregister completeness (MUST):** every descendant that was registered MUST leave the map. A leaked entry is a memory leak and a latent wrong-target bug (§5.9.1.4).

---

## Algorithm — `buildFromDocument` + checksum (D-SPEC-4 / PP-EST-7)

Producer and client MUST use the **same** mix. Normative client-side algorithm:

```
FNV_OFFSET = 0x811c9dc5
FNV_PRIME  = 0x01000193

fnv1a_u32(h, byte):
  h = (h ^ byte) * FNV_PRIME   // truncate to u32 after each step

mix_u32(h, value):
  mix four little-endian bytes of value

mix_utf8(h, s):
  for each UTF-8 byte of s: fnv1a_u32

buildFromDocument(doc):
  clear()   // replace prior epoch contents
  h = FNV_OFFSET
  nodeCount = 0
  walker = document-order walk of doc (TreeWalker SHOW_ELEMENT|SHOW_TEXT|SHOW_COMMENT
           OR recursive childNodes — MUST match producer order: depth-first preorder
           of the published tree as parsed)

  for each node in walker:
    attr = getAttribute('speculum-anchor') if Element;
         for Text/Comment: attribute is not standard — establish HTML uses
         wrapper elements OR data on parent per sidecar establish.md.
         **Normative for this pack:** establish HTML places `speculum-anchor`
         on Elements; Text and Comment ids appear as sibling marker elements
         only if F publishes them that way — OR text/comment nodes carry
         id via a preceding processing convention documented in sidecar
         establish.md. Client registry MUST register every node the producer
         counted in establishEnd.nodeCount.

    When an anchored node is found:
      id = parseUint32(attr)
      if map.has(id): checksum/path error → caller desync (duplicate)
      map.set(id, node)
      nodeCount++
      mix_u32(h, id)
      kindByte =
        ELEMENT → 1
        TEXT    → 2
        COMMENT → 3
      fnv1a_u32(h, kindByte)
      if ELEMENT: mix_utf8(h, tagName.toLowerCase())  // or exact producer case — MUST match establish.md
      else: mix_utf8(h, "")  // empty tag for text/comment per contract 05

  return { nodeCount, checksum: h }
```

**Verify (caller):**

```
if (result.nodeCount !== establishEnd.nodeCount) → desync establish_node_count_mismatch
if (result.checksum !== establishEnd.checksum) → desync establish_checksum_mismatch
```

Exact UTF-8 tag casing and Text/Comment anchoring encoding are locked in `implementation/sidecar/establish.md`; this module MUST implement the **client half** of that same algorithm bit-for-bit. If sidecar establish MD and this MD diverge → GAP.md, do not guess.

---

## Algorithm — `clear`

1. `map.clear()`.
2. Reset any cached size counters.
3. MUST NOT touch the Document nodes (surface owns DOM lifetime).

---

## Coupling

| Caller | Use |
|--------|-----|
| `applyDom` | `get` / `set` / `deleteSubtree` during live ops |
| `applyCssom` | Dom pierceHost hosts via Dom registry for scope attach; Cssom ids live in a **separate** Cssom registry (see applyCssom.md) — Dom `Registry` never stores sheet/rule ids |
| `surface` / `ProjectionClient` | `buildFromDocument` after `establishEnd`; `clear` on buffer retire |
| `interaction` | `get(nodeId)` for hit → intent addressing |

---

## Tests (effect asserts)

| ID | Assert |
|----|--------|
| `PP-EST-7` | Mismatched `nodeCount` or `checksum` after `buildFromDocument` causes desync; map not left armed |
| `PP-EST-5` | Registry verified before arm (orchestration) |
| `PP-MOVE-1..3` | Move uses `get` existing id; no destroy/recreate (applyDom + registry) |
| `PP-NAV-3` | Retired buffer: `clear()`; size 0; no cross-buffer `get` hits |
| `PP-F-2` | Walk never calls `normalize()` |
| `PP-ID-3` (client half) | Text/comment ids registered when present in establish HTML |

Unit (web): synthetic HTML with known anchors → known checksum vector fixtures shared with sidecar establish tests.
