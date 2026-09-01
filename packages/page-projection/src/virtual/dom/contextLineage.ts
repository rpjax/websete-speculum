/**
 * contextId → parentContextId registry (root-owned, filled at scope admit).
 */

import { CONTEXT_ID_ROOT } from '../../core/frame';

export class ContextLineageIndex {
  private readonly parentOf = new Map<number, number>();

  register(childContextId: number, parentContextId: number): void {
    if (childContextId <= 0 || parentContextId <= 0) return;
    this.parentOf.set(childContextId, parentContextId);
  }

  getParent(childContextId: number): number | undefined {
    return this.parentOf.get(childContextId);
  }

  /** Direct child of root on the path from leaf → root (first iframe hop from root). */
  directChildOfRootOnPath(leafContextId: number): number {
    if (leafContextId === CONTEXT_ID_ROOT) return CONTEXT_ID_ROOT;
    let cur = leafContextId;
    for (;;) {
      const parent = this.parentOf.get(cur);
      if (parent === undefined || parent === CONTEXT_ID_ROOT) return cur;
      cur = parent;
    }
  }

  /** Hops from leaf up to (excluding) root: [leaf, ..., directChildOfRoot]. */
  chainLeafToRoot(leafContextId: number): number[] {
    if (leafContextId === CONTEXT_ID_ROOT) return [];
    const chain: number[] = [];
    let cur = leafContextId;
    while (cur !== CONTEXT_ID_ROOT) {
      chain.push(cur);
      const parent = this.parentOf.get(cur);
      if (parent === undefined) break;
      cur = parent;
    }
    return chain;
  }
}
