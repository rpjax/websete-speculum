# Contract 09 — Client apply

**Norm:** redesign §5.9.1. **Tests:** PP-MOVE-*, ACID with FR-6. **Impl:** `applyDom.md`, `applyCssom.md`, `registry.md`, `ProjectionClient.md`.

## Apply loop

1. Queue frames on arrival; apply inside `requestAnimationFrame`. All pending frames in one callback, `sequence` order.  
2. During apply MUST NOT read layout (`getBoundingClientRect`, `offsetTop`, `scrollHeight`, computed style). Reads only before/after write batch.  
3. Budget E9 / `applyBudgetMs` (4 ms). Overrun → ClientState `overrunCount` + telemetry `Frame.ApplyOverrun`.  
4. Registry O(1): register on construct; unregister on remove including descendants.

## ACID

1. Resolve **every** address in the assembled frame before mutating.  
2. Any miss ⇒ desync (no partial apply).  
3. Parts assembled first (contract 04).

## `childList` FULL apply

1. Resolve all `existing` ids — miss ⇒ desync.  
2. Remove current children absent from list (unregister subtrees).  
3. Place nodes in declared order; `existing` = **move**, not destroy/recreate.  
4. Construct+register `fresh`.

## `patch` apply

Apply full snapshot fields/attrs/state; no children. Idempotent. Caret rules when applying `speculum-input-value` (contract 10).

## Registry

```ts
interface Registry {
  get(id: number): Node | undefined;
  set(id: number, node: Node): void;
  deleteSubtree(id: number): void;
  buildFromDocument(doc: Document): { nodeCount: number; checksum: number };
  clear(): void;
}
```

Live resolution MUST use the map, not `querySelector('[speculum-anchor]')`, for correctness (attribute MAY remain on nodes).
