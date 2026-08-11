import type { NodeId } from './identity';
import type { FNode } from './fmap';
import { VIEWPORT_SCROLL_TARGET, type DirtyState, type ScrollSample } from './observe';

/**
 * §5.3 — the frame model. `FrameAccumulator` owns the net-effect coalescing
 * and the flush order from §5.3.3; the tree-shaped questions it needs
 * answered (connectivity, current child order, full snapshots, document
 * order) are asked of an injected `FrameTreeQuery` so this file has no DOM
 * dependency and unit-tests against a plain mock tree.
 */

export type ChildRef = { kind: 'existing'; id: NodeId } | { kind: 'fresh'; node: FNode };

export type ChildListOp = {
  op: 'childList';
  parent: NodeId;
  mode: 'full' | 'append';
  children: ChildRef[];
};

export type PatchOp = { op: 'patch'; node: NodeId; snapshot: FNode };
export type ScrollViewportOp = { op: 'scrollViewport'; x: number; y: number };
export type ScrollElementOp = { op: 'scrollElement'; node: NodeId; top: number; left: number };

export type FrameOp = ChildListOp | PatchOp | ScrollViewportOp | ScrollElementOp;

export interface FrameTreeQuery<TNode extends object = object> {
  isConnected(node: TNode): boolean;
  resolve(id: NodeId): TNode | undefined;
  /** True if `id` equals, or is a descendant (anywhere up its published ancestor chain) of, a member of `ancestors`. */
  isWithin(id: NodeId, ancestors: ReadonlySet<NodeId>): boolean;
  /** Full, current F-visible child list of `parentId`; undefined if the parent itself is gone. */
  childListSnapshot(parentId: NodeId): ChildRef[] | undefined;
  /** Flush-time full F snapshot (§5.4.1: no children on the wire) for `patch`; undefined if gone. */
  fullSnapshot(id: NodeId): FNode | undefined;
  /** Stable document-order comparator across published ids — ancestors sort before descendants. */
  compareDocumentOrder(a: NodeId, b: NodeId): number;
}

function childRefIds(refs: readonly ChildRef[]): NodeId[] {
  return refs.map((r) => (r.kind === 'existing' ? r.id : r.node.id));
}

function isPrefix(previous: readonly NodeId[], current: readonly NodeId[]): boolean {
  if (previous.length > current.length) return false;
  for (let i = 0; i < previous.length; i++) {
    if (previous[i] !== current[i]) return false;
  }
  return true;
}

export class FrameAccumulator<TNode extends object = object> {
  readonly newIds = new Set<NodeId>();
  readonly dirtyParents = new Set<NodeId>();
  readonly attrDirty = new Set<NodeId>();
  readonly textDirty = new Set<NodeId>();
  readonly stateDirty = new Set<NodeId>();
  readonly scrollDirty = new Map<NodeId, ScrollSample>();
  readonly detached = new Set<NodeId>();

  /** Last emitted child-id order per parent, so §5.4.2's APPEND fast path can be detected. */
  private readonly lastEmittedChildren = new Map<NodeId, NodeId[]>();

  constructor(private readonly query: FrameTreeQuery<TNode>) {}

  /** Merges one observe.ts `DirtyState` snapshot in (§5.3.2 accumulation). */
  absorb(dirty: DirtyState): void {
    for (const id of dirty.newIds) this.newIds.add(id);
    for (const id of dirty.dirtyParents) this.dirtyParents.add(id);
    for (const id of dirty.attrDirty) this.attrDirty.add(id);
    for (const id of dirty.textDirty) this.textDirty.add(id);
    for (const id of dirty.stateDirty) this.stateDirty.add(id);
    for (const id of dirty.detached) this.detached.add(id);
    for (const [target, sample] of dirty.scrollDirty) this.scrollDirty.set(target, sample);
  }

  /** §5.3.3 — flush in the mandated order. Returns null when there is nothing to send (PP-FR-4). */
  flush(): FrameOp[] | null {
    this.pruneEphemerals();
    this.pruneWithin(this.newIds); // absorb descendants (step 2)
    this.pruneWithin(this.detached); // prune orphans (step 3)

    const ops: FrameOp[] = [];
    this.emitChildLists(ops); // step 4
    this.emitPatches(ops); // step 5
    this.emitScroll(ops); // step 7 (step 6 — cssom — is a sibling plane, merged by the caller)

    this.forgetDetachedParents();
    this.reset();
    return ops.length > 0 ? ops : null;
  }

  /** Step 1 — a node created and destroyed within the frame is never sent. */
  private pruneEphemerals(): void {
    for (const id of [...this.newIds]) {
      const node = this.query.resolve(id);
      if (node === undefined || !this.query.isConnected(node)) {
        this.newIds.delete(id);
        this.discardAllFor(id);
      }
    }
  }

  /** Steps 2 and 3 share one shape: drop entries whose id is within `ancestors`. */
  private pruneWithin(ancestors: ReadonlySet<NodeId>): void {
    if (ancestors.size === 0) return;
    for (const id of [...this.attrDirty]) if (this.query.isWithin(id, ancestors)) this.attrDirty.delete(id);
    for (const id of [...this.textDirty]) if (this.query.isWithin(id, ancestors)) this.textDirty.delete(id);
    for (const id of [...this.stateDirty]) if (this.query.isWithin(id, ancestors)) this.stateDirty.delete(id);
    for (const id of [...this.dirtyParents]) if (this.query.isWithin(id, ancestors)) this.dirtyParents.delete(id);
  }

  private emitChildLists(ops: FrameOp[]): void {
    const parents = [...this.dirtyParents].sort((a, b) => this.query.compareDocumentOrder(a, b));
    for (const parentId of parents) {
      const current = this.query.childListSnapshot(parentId);
      if (current === undefined) continue;
      const currentIds = childRefIds(current);
      const previous = this.lastEmittedChildren.get(parentId);
      const append = previous !== undefined && isPrefix(previous, currentIds);
      const appended = append ? current.slice(previous!.length) : current;
      if (append && appended.length === 0) {
        this.lastEmittedChildren.set(parentId, currentIds);
        continue; // marked dirty but no net change — nothing to send.
      }
      ops.push({
        op: 'childList',
        parent: parentId,
        mode: append ? 'append' : 'full',
        children: appended,
      });
      this.lastEmittedChildren.set(parentId, currentIds);
    }
  }

  private emitPatches(ops: FrameOp[]): void {
    const dirty = new Set<NodeId>([...this.attrDirty, ...this.textDirty, ...this.stateDirty]);
    for (const id of dirty) {
      const snapshot = this.query.fullSnapshot(id);
      if (snapshot === undefined) continue;
      ops.push({ op: 'patch', node: id, snapshot });
    }
  }

  private emitScroll(ops: FrameOp[]): void {
    for (const [target, sample] of this.scrollDirty) {
      if (target === VIEWPORT_SCROLL_TARGET) {
        ops.push({ op: 'scrollViewport', x: sample.x, y: sample.y });
      } else {
        ops.push({ op: 'scrollElement', node: target, top: sample.y, left: sample.x });
      }
    }
  }

  /** Evict the append-cache for parents that were themselves detached this frame. */
  private forgetDetachedParents(): void {
    for (const id of this.detached) this.lastEmittedChildren.delete(id);
  }

  private discardAllFor(id: NodeId): void {
    this.attrDirty.delete(id);
    this.textDirty.delete(id);
    this.stateDirty.delete(id);
    this.dirtyParents.delete(id);
    this.scrollDirty.delete(id);
  }

  private reset(): void {
    this.newIds.clear();
    this.dirtyParents.clear();
    this.attrDirty.clear();
    this.textDirty.clear();
    this.stateDirty.clear();
    this.scrollDirty.clear();
    this.detached.clear();
  }
}
