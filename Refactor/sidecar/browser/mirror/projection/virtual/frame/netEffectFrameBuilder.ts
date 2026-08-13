/**
 * FrameBuilder impl — Frozen dirty → logical Frame (§5.3.3).
 */

import { OpCode, opCodeName } from '../../models/opcodes';
import {
  createLiveFrame,
  type ChildListMode,
  type ChildRef,
  type DomNodeSnapshot,
  type Frame,
  type FrameOp,
} from '../../models/frame';
import { NONE_DOM_NODE_KEY, type DomNodeKey } from '../../models/domNodeKey';
import type { DomNodeTable } from '../dom/domNodeTable';
import {
  VIEWPORT_SCROLL_KEY,
  dirtyCard,
  dirtySetsHaveWork,
  type DirtySets,
} from '../models/dirtySets';
import type { ChildListDecisionFact } from '../../models/telemetry';
import { CHILD_LIST_FACT_CAP } from '../../models/telemetry';
import type { FrameBuildDecision, FrameBuilder, FrameBuilderContext } from './frameBuilder';
import {
  documentOrderCompare,
  listFVisibleChildren,
  snapshotNodeFlat,
  snapshotNodeSubtree,
} from './fVisible';

export type { FrameBuilder, FrameBuilderContext };

export type NetEffectFrameBuilderOptions = {
  domNodes: DomNodeTable;
};

function removeKeyFromSets(sets: DirtySets, key: DomNodeKey): void {
  sets.newKeys.delete(key);
  sets.dirtyParents.delete(key);
  sets.attrDirty.delete(key);
  sets.textDirty.delete(key);
  sets.stateDirty.delete(key);
  sets.detached.delete(key);
  sets.scrollDirty.delete(key);
}

function cloneDirtySets(src: DirtySets): DirtySets {
  return {
    newKeys: new Set(src.newKeys),
    dirtyParents: new Set(src.dirtyParents),
    attrDirty: new Set(src.attrDirty),
    textDirty: new Set(src.textDirty),
    stateDirty: new Set(src.stateDirty),
    scrollDirty: new Map(src.scrollDirty),
    detached: new Set(src.detached),
  };
}

function isSuffixAppend(prev: readonly DomNodeKey[], next: readonly DomNodeKey[]): boolean {
  // Empty prev is not a suffix-append: the parent may already be painted (establish).
  if (prev.length === 0) return false;
  if (next.length <= prev.length) return false;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i] !== next[i]) return false;
  }
  return true;
}

export class NetEffectFrameBuilder implements FrameBuilder {
  private readonly domNodes: DomNodeTable;
  /** Keys successfully published on the wire (this generation). */
  private readonly published = new Set<DomNodeKey>();
  /** Last FULL/APPEND-resolved child key list per parent. */
  private readonly lastChildLists = new Map<DomNodeKey, DomNodeKey[]>();
  private lastStats: FrameBuildDecision | null = null;
  private lastChildListFacts: ChildListDecisionFact[] = [];

  constructor(opts: NetEffectFrameBuilderOptions) {
    this.domNodes = opts.domNodes;
  }

  /** Test / generation bump. */
  clearPublishState(): void {
    this.published.clear();
    this.lastChildLists.clear();
  }

  takeBuildStats(): FrameBuildDecision | null {
    const s = this.lastStats;
    this.lastStats = null;
    return s;
  }

  publishState(): { publishedCount: number; lastChildListsParents: number } {
    return {
      publishedCount: this.published.size,
      lastChildListsParents: this.lastChildLists.size,
    };
  }

  /** Seed ids already published by establish. */
  seedPublished(keys: Iterable<DomNodeKey>): void {
    for (const key of keys) this.published.add(key);
  }

  /** Seed last FULL child lists from the establish walk (handoff). */
  seedChildLists(lists: Iterable<readonly [DomNodeKey, readonly DomNodeKey[]]>): void {
    for (const [parent, children] of lists) {
      this.lastChildLists.set(parent, children.slice());
    }
  }

  build(frozen: DirtySets, ctx: FrameBuilderContext): Frame | null {
    if (!dirtySetsHaveWork(frozen)) return null;

    const dirtyIn = dirtyCard(frozen);
    const work = cloneDirtySets(frozen);
    const ephemeralPruned = this.pruneEphemerals(work);
    const absorbed = this.absorbDescendants(work);
    const orphaned = this.pruneOrphans(work);

    if (!dirtySetsHaveWork(work)) return null;

    const dirtyOut = dirtyCard(work);
    const lastChildListsEmpty = this.lastChildLists.size === 0;
    const ops: FrameOp[] = [];
    const freshlyEmitted = new Set<DomNodeKey>();
    this.lastChildListFacts = [];

    this.emitChildLists(work, ops, freshlyEmitted);
    this.emitPatches(work, ops, freshlyEmitted);
    this.emitScrolls(work, ops);

    if (ops.length === 0) return null;

    for (const key of freshlyEmitted) this.published.add(key);

    const opCounts: Record<string, number> = {};
    for (const op of ops) {
      const name = opCodeName(op.op);
      opCounts[name] = (opCounts[name] ?? 0) + 1;
    }

    const allFacts = this.lastChildListFacts;
    const childLists = allFacts.slice(0, CHILD_LIST_FACT_CAP);
    let appendFromEmptyCount = 0;
    for (let i = 0; i < allFacts.length; i++) {
      if (allFacts[i]!.appendFromEmpty) appendFromEmptyCount += 1;
    }

    this.lastStats = {
      ephemeralPruned,
      absorbed,
      orphaned,
      opCounts,
      publishedCount: this.published.size,
      lastChildListsParents: this.lastChildLists.size,
      lastChildListsEmpty,
      dirtyIn,
      dirtyOut,
      childLists,
      childListsOmitted: Math.max(0, allFacts.length - childLists.length),
      patches: opCounts.patch ?? 0,
      scrolls: (opCounts.scrollViewport ?? 0) + (opCounts.scrollElement ?? 0),
      appendFromEmptyCount,
    };

    return createLiveFrame({
      generation: ctx.generation,
      sequence: ctx.sequence,
      ops,
    });
  }

  private pruneEphemerals(work: DirtySets): number {
    const doomed: DomNodeKey[] = [];
    for (const key of work.newKeys) {
      const node = this.domNodes.get(key);
      if (node === undefined || !node.isConnected) doomed.push(key);
    }
    for (const key of doomed) removeKeyFromSets(work, key);
    return doomed.length;
  }

  private nearestKeyedAncestor(node: Node): DomNodeKey {
    let cur: Node | null = node.parentNode;
    while (cur !== null) {
      const key = this.domNodes.keyOf(cur);
      if (key !== NONE_DOM_NODE_KEY) return key;
      cur = cur.parentNode;
    }
    return NONE_DOM_NODE_KEY;
  }

  private absorbDescendants(work: DirtySets): number {
    let removed = 0;
    const candidates = new Set<DomNodeKey>([
      ...work.newKeys,
      ...work.attrDirty,
      ...work.textDirty,
      ...work.stateDirty,
      ...work.dirtyParents,
      ...work.detached,
    ]);
    for (const [k] of work.scrollDirty) {
      if (k !== VIEWPORT_SCROLL_KEY) candidates.add(k);
    }

    for (const key of candidates) {
      if (work.newKeys.has(key) && this.isTopLevelNew(key, work)) continue;
      const node = this.domNodes.get(key);
      if (node === undefined) continue;
      const anc = this.nearestKeyedAncestor(node);
      if (anc === NONE_DOM_NODE_KEY) continue;
      if (!work.newKeys.has(anc)) continue;
      // Individual entries discarded — state rides in ancestor fresh snapshot.
      removeKeyFromSets(work, key);
      removed += 1;
    }
    return removed;
  }

  /** True if no ancestor is also in newKeys. */
  private isTopLevelNew(key: DomNodeKey, work: DirtySets): boolean {
    const node = this.domNodes.get(key);
    if (node === undefined) return true;
    let cur: Node | null = node.parentNode;
    while (cur !== null) {
      const anc = this.domNodes.keyOf(cur);
      if (anc !== NONE_DOM_NODE_KEY && work.newKeys.has(anc)) return false;
      cur = cur.parentNode;
    }
    return true;
  }

  private pruneOrphans(work: DirtySets): number {
    if (work.detached.size === 0) return 0;
    let removed = 0;
    const candidates = new Set<DomNodeKey>([
      ...work.newKeys,
      ...work.attrDirty,
      ...work.textDirty,
      ...work.stateDirty,
      ...work.dirtyParents,
    ]);
    for (const [k] of work.scrollDirty) {
      if (k !== VIEWPORT_SCROLL_KEY) candidates.add(k);
    }

    for (const key of candidates) {
      if (work.detached.has(key)) continue;
      const node = this.domNodes.get(key);
      if (node === undefined) {
        removeKeyFromSets(work, key);
        removed += 1;
        continue;
      }
      if (this.hasDetachedAncestor(node, work.detached)) {
        removeKeyFromSets(work, key);
        removed += 1;
      }
    }
    return removed;
  }

  private hasDetachedAncestor(node: Node, detached: Set<DomNodeKey>): boolean {
    let cur: Node | null = node.parentNode;
    while (cur !== null) {
      const key = this.domNodes.keyOf(cur);
      if (key !== NONE_DOM_NODE_KEY && detached.has(key)) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  private emitChildLists(
    work: DirtySets,
    ops: FrameOp[],
    freshlyEmitted: Set<DomNodeKey>,
  ): void {
    const parents = [...work.dirtyParents];
    parents.sort((a, b) => {
      const na = this.domNodes.get(a);
      const nb = this.domNodes.get(b);
      if (na === undefined || nb === undefined) return a - b;
      return documentOrderCompare(na, nb);
    });

    for (const parentKey of parents) {
      const parent = this.domNodes.get(parentKey);
      if (parent === undefined) continue;

      const childNodes = listFVisibleChildren(parent);
      const childKeys: DomNodeKey[] = [];
      for (let i = 0; i < childNodes.length; i++) {
        childKeys.push(this.domNodes.allocate(childNodes[i]!));
      }

      const prev = this.lastChildLists.get(parentKey) ?? [];
      let mode: ChildListMode = 'full';
      let emitKeys = childKeys;
      if (isSuffixAppend(prev, childKeys)) {
        mode = 'append';
        emitKeys = childKeys.slice(prev.length);
      }

      const freshSnapshots = new Map<DomNodeKey, DomNodeSnapshot>();
      const children: ChildRef[] = [];
      let nExisting = 0;
      let nFresh = 0;

      for (let i = 0; i < emitKeys.length; i++) {
        const key = emitKeys[i]!;
        const wasPublished = this.published.has(key) && !work.newKeys.has(key);
        if (wasPublished) {
          children.push({ kind: 'existing', key });
          freshlyEmitted.add(key);
          nExisting += 1;
        } else {
          children.push({ kind: 'fresh', key });
          nFresh += 1;
          const node = this.domNodes.get(key);
          if (node !== undefined) {
            const snap = snapshotNodeSubtree(key, node, this.domNodes, (k) =>
              freshlyEmitted.add(k),
            );
            if (snap !== null) freshSnapshots.set(key, snap);
          }
          freshlyEmitted.add(key);
        }
      }

      ops.push({
        op: OpCode.ChildList,
        parent: parentKey,
        mode,
        children,
        freshSnapshots: freshSnapshots.size > 0 ? freshSnapshots : undefined,
      });

      this.lastChildLists.set(parentKey, childKeys.slice());
      freshlyEmitted.add(parentKey);
      this.lastChildListFacts.push({
        parent: parentKey,
        mode,
        childCount: children.length,
        nExisting,
        nFresh,
        prevCount: prev.length,
        appendFromEmpty: mode === 'append' && prev.length === 0 && children.length > 0,
      });
    }
  }

  private emitPatches(
    work: DirtySets,
    ops: FrameOp[],
    freshlyEmitted: Set<DomNodeKey>,
  ): void {
    const patchKeys = new Set<DomNodeKey>([
      ...work.attrDirty,
      ...work.textDirty,
      ...work.stateDirty,
    ]);

    for (const key of patchKeys) {
      // Skip if only appeared as fresh this frame under a childList (redundant but safe).
      // Still emit if explicitly attr/text dirty and already published — full snapshot heals.
      if (work.newKeys.has(key) && !this.published.has(key)) {
        // New node patches ride in fresh snapshot unless the node is only attr-dirty
        // without a dirty parent (rare). Prefer skip when absorbed already removed them.
        continue;
      }

      const node = this.domNodes.get(key);
      if (node === undefined || !node.isConnected) continue;
      const snap = snapshotNodeFlat(key, node);
      if (snap === null) continue;
      ops.push({ op: OpCode.Patch, node: key, snapshot: snap });
      freshlyEmitted.add(key);
    }
  }

  private emitScrolls(work: DirtySets, ops: FrameOp[]): void {
    for (const [key, sample] of work.scrollDirty) {
      if (key === VIEWPORT_SCROLL_KEY) continue;
      ops.push({
        op: OpCode.ScrollElement,
        node: key,
        scrollTop: sample.y,
        scrollLeft: sample.x,
      });
    }
    const viewport = work.scrollDirty.get(VIEWPORT_SCROLL_KEY);
    if (viewport !== undefined) {
      ops.push({
        op: OpCode.ScrollViewport,
        scrollX: viewport.x,
        scrollY: viewport.y,
      });
    }
  }
}
