/**
 * Producer frame construction — frame-protocol.md §5. Single-pass DFS over the tick's
 * MutationRecords: reuse-or-create, `NODE_NEW` on the way down, one batched `INSERT` per
 * contiguous sibling run on the way up (post-order — a finished, still-detached subtree
 * attaches in one op regardless of size; see `walkSiblingRun`/`prepareChild` for why a whole
 * run of new siblings shares one `INSERT` and one anchor lookup, not one each). Deletion is
 * deferred to end-of-tick (§5.6) so a same-tick move costs one `INSERT`, not an `INSERT` +
 * a `REMOVE`. Replaces `netEffectFrameBuilder.ts` (dirty-set / net-effect model, dead per
 * HANDOFF.md §13) wholesale — there is no dirty-set bucketing here at all; structure comes
 * straight from the records plus the live DOM read at drain time.
 *
 * v0 scope: DOM only (no CSSOM), no persistent string interning (§1.7 — every string is
 * frame-local; see binaryFrameEncoder.ts). PP-FR-1: addedNodes that are not `isConnected` at
 * drain are never allocated (create+destroy in one tick never hits the wire). `REMOVE` is
 * "ended the tick detached and already had an id", not "was not visited" (visited ≠ move).
 *
 * `preTableHash`/`tableHash` (§1.5): the builder maintains a `ReplicatedTable` alongside
 * `DomNodeTable` — the same shared table+hash model the client maintains during Phase 1 of apply
 * (`models/replicatedTable.ts`, `models/replicatedTableApply.ts`). `preTableHash` is captured
 * *before* this tick's ops are folded into the table, so it verifies the state the client's own
 * table must already be in before this frame applies (§2).
 */

import { OpCode, opCodeName } from '../../models/opcodes';
import { createFrame, INSERT_AT_END, type AttrPair, type Frame, type FrameOp } from '../../models/frame';
import { MAX_DIRTY_NODES, MAX_NODE_DROPS_PER_SWEEP, NODE_DROP_AGE_SEQUENCES } from '../../models/limits';
import { NONE_DOM_NODE_KEY, type DomNodeKey } from '../../models/domNodeKey';
import type { DomNodeTable } from './domNodeTable';
import type { ReplicatedTable } from '../../models/replicatedTable';
import { applyOpsToTable } from '../../models/replicatedTableApply';
import type { FrameBuilder, FrameBuilderContext, FrameBuildStats } from '../frame/frameBuilder';
import { describeNodeNew, nodeKindOf } from './domNodeDescribe';

/** Shared sentinel returned when `collectOpCounts` is off — never mutated. */
const EMPTY_OP_COUNTS: Record<string, number> = {};

export type TableFrameBuilderOptions = {
  domNodes: DomNodeTable;
  /** Shared row/hash table (§1.3-§1.5) — same instance kind the client maintains during Phase 1. */
  table: ReplicatedTable;
  /**
   * Compute the per-opcode `opCounts` breakdown in `FrameBuildStats` — a "cheap volume signal
   * for the perf pass" (frameBuilder.ts), not consumed by `frameEmitter.ts`/telemetry today.
   * Off by default so the hot path never pays for a breakdown nothing reads; the lab CLI/perf
   * scripts can turn it on when actually diagnosing op-mix. `buildMs` is always measured either
   * way — that one IS consumed (`recordFrameEmitted`).
   */
  collectOpCounts?: boolean;
  /** Override for tests/lab tuning — §1.6/OPEN-2 GC-sweep age threshold (frame `sequence`s). */
  nodeDropAgeSequences?: number;
  /** Override for tests/lab tuning — §8 per-tick GC-sweep cap. */
  maxNodeDropsPerSweep?: number;
};

export class TableFrameBuilder implements FrameBuilder {
  private readonly domNodes: DomNodeTable;
  private readonly table: ReplicatedTable;
  private readonly collectOpCounts: boolean;
  private readonly nodeDropAgeSequences: number;
  private readonly maxNodeDropsPerSweep: number;
  private lastStats: FrameBuildStats | null = null;
  private pendingUnconsumed: MutationRecord[] | null = null;

  // Reused across ticks (`.clear()`ed at the top of `build()`) instead of allocated fresh every
  // tick — at a sustained frame rate this is 5 fewer heap allocations per tick, directly the GC
  // pressure identified in the 2026-08-13 CPU profile behind the buildMs p95/max spikes.
  private readonly visited = new Set<Node>();
  private readonly createdThisTick = new Set<Node>();
  /** node -> the parent it was removed from, captured before any deferred decision (§5.6). */
  private readonly removedThisTick = new Map<Node, Node>();
  private readonly attrDirty = new Map<Node, Set<string>>();
  private readonly textDirty = new Set<Node>();

  constructor(opts: TableFrameBuilderOptions) {
    this.domNodes = opts.domNodes;
    this.table = opts.table;
    this.collectOpCounts = opts.collectOpCounts ?? false;
    this.nodeDropAgeSequences = opts.nodeDropAgeSequences ?? NODE_DROP_AGE_SEQUENCES;
    this.maxNodeDropsPerSweep = opts.maxNodeDropsPerSweep ?? MAX_NODE_DROPS_PER_SWEEP;
  }

  takeBuildStats(): FrameBuildStats | null {
    const s = this.lastStats;
    this.lastStats = null;
    return s;
  }

  /** §8 `MAX_DIRTY_NODES` — records left over when this tick's visited-set cap forced an early stop. */
  takeUnconsumedRecords(): MutationRecord[] | null {
    const r = this.pendingUnconsumed;
    this.pendingUnconsumed = null;
    return r;
  }

  /**
   * `records` may legitimately be empty — `frameEmitter.ts` also calls this on a periodic,
   * mutation-independent cadence purely so `emitNodeDropSweep` below gets a chance to run during
   * an otherwise-idle session (a detached row does not need *new* mutations to become GC-eligible,
   * only time/`sequence` to pass — §1.6).
   */
  build(records: MutationRecord[], ctx: FrameBuilderContext): Frame | null {
    const start = performance.now();

    // §2: "expected tableHash before applying" — captured before this tick's ops fold into
    // `this.table` below, so it verifies exactly the state the client's own table must already
    // be in.
    const preTableHash = this.table.tableHash;

    const ops: FrameOp[] = [];
    this.pendingUnconsumed = null;

    if (records.length > 0) {
      this.visited.clear();
      this.createdThisTick.clear();
      this.removedThisTick.clear();
      this.attrDirty.clear();
      this.textDirty.clear();

      let consumedThrough = records.length;
      for (let i = 0; i < records.length; i++) {
        const record = records[i]!;
        if (record.type === 'childList') {
          this.walkChildList(record, ops);
          // §5.3/§8 MAX_DIRTY_NODES — forces a flush of whatever has been walked so far rather
          // than letting one oversized tick's visited set grow without bound; the records this
          // tick never got to are handed back to the caller (`takeUnconsumedRecords`) to reclaim
          // into the mutation buffer for the next tick, unchanged, in wire order.
          if (this.visited.size >= MAX_DIRTY_NODES) {
            consumedThrough = i + 1;
            break;
          }
        } else if (record.type === 'attributes') {
          const name = record.attributeName;
          if (name === null) continue;
          let set = this.attrDirty.get(record.target);
          if (set === undefined) {
            set = new Set();
            this.attrDirty.set(record.target, set);
          }
          set.add(name);
        } else if (record.type === 'characterData') {
          this.textDirty.add(record.target);
        }
      }
      if (consumedThrough < records.length) {
        this.pendingUnconsumed = records.slice(consumedThrough);
      }

      this.emitDeferredRemoves(ops);
      this.emitAttrPatches(ops);
      this.emitTextPatches(ops);
    }

    // Virtual side applies phase 1 (table) only, per §6 — the real DOM already mutated, which is
    // what the MutationObserver just reported; there is no phase 2 to run against a live DOM here.
    //
    // Fold this tick's own structural ops into `this.table` *before* the GC sweep below queries
    // it, not after: `collectDroppableIds` (inside `emitNodeDropSweep`) only sees `parent === 0`
    // rows as drop candidates, but it was reading `this.table`'s state from *before* this tick's
    // own `INSERT`s (built into `ops` just above, from this tick's own `MutationRecord`s) had
    // been applied. A node reattached by one of those same-tick `INSERT`s still looked detached
    // to the sweep, so it could be selected as a GC candidate too — one frame emitting both an
    // `INSERT` re-attaching an id and a `NODE_DROP` for that same id. The client's own §4.2
    // precondition guard already rejects that (attached rows can't be dropped) rather than
    // corrupting silently, but the producer should never construct a self-contradictory frame in
    // the first place (found by inspection, 2026-08-14, the same-tick sibling of the subtree-
    // resurrection gap fixed just above in `emitNodeDropSweep`). Applying these ops first means
    // the sweep always sees this tick's *final* topology, so a same-tick reattach makes the node
    // `parent !== 0` before `collectDroppableIds` ever looks at it.
    this.table.setSequence(ctx.sequence);
    applyOpsToTable(this.table, ops);

    const dropOpIndex = ops.length;
    this.emitNodeDropSweep(ops, ctx.sequence);
    if (ops.length > dropOpIndex) applyOpsToTable(this.table, ops.slice(dropOpIndex));

    if (ops.length === 0) return null;

    let opCounts: Record<string, number> = EMPTY_OP_COUNTS;
    if (this.collectOpCounts) {
      opCounts = {};
      for (let i = 0; i < ops.length; i++) {
        const name = opCodeName(ops[i]!.op);
        opCounts[name] = (opCounts[name] ?? 0) + 1;
      }
    }
    this.lastStats = {
      opCounts,
      buildMs: performance.now() - start,
      tableSize: this.table.size,
      identitySize: this.domNodes.size,
    };

    return createFrame({ generation: ctx.generation, sequence: ctx.sequence, ops, preTableHash });
  }

  /**
   * OPEN-2 deferred-age GC (§1.6, §5.6): sweep the table's own detached-subtree-root candidates
   * (independent of whatever this tick's `MutationRecord`s were about — a row can go idle
   * without anything mutating it further) and, for whatever the sweep selects, release the
   * matching `DomNodeTable` identity entry too — the whole point of the sweep is bounding *this*
   * producer-side map's growth, not just the wire-visible table's.
   *
   * Releases the *whole* subtree (root + every descendant, via `ReplicatedTable.subtreeIds` —
   * the same discovery walk `dropSubtree` itself uses, queried read-only here before the table
   * effect runs), not just the swept root id: `collectDroppableIds` only ever returns detached
   * roots (§4.2 — descendants are never listed on the wire on their own), so releasing only the
   * root left every descendant's `DomNodeTable` entry stale. A live page-JS reference that later
   * reinserts such a descendant would have found `domNodes.keyOf()` still resolving to its old,
   * by-then-already-dropped id — treating it as "already indexed, just move" instead of
   * re-describing it as new content, silently corrupting `ReplicatedTable` with a bogus
   * fallback row (`replicatedTable.ts`'s `linkAfter`) instead of a clean re-`NODE_NEW` (found by
   * inspection, 2026-08-14, chasing whether subtree resurrection is handled naturally).
   */
  private emitNodeDropSweep(ops: FrameOp[], sequence: number): void {
    const rootIds = this.table.collectDroppableIds(sequence, this.nodeDropAgeSequences, this.maxNodeDropsPerSweep);
    if (rootIds.length === 0) return;
    for (let i = 0; i < rootIds.length; i++) {
      const subtreeIds = this.table.subtreeIds(rootIds[i]!);
      for (let j = 0; j < subtreeIds.length; j++) {
        const node = this.domNodes.get(subtreeIds[j]!);
        if (node !== undefined) this.domNodes.release(node);
      }
    }
    ops.push({ op: OpCode.NodeDrop, ids: rootIds });
  }

  private walkChildList(record: MutationRecord, ops: FrameOp[]): void {
    const parent = record.target;
    for (let i = 0; i < record.removedNodes.length; i++) {
      const node = record.removedNodes[i]!;
      if (!this.removedThisTick.has(node)) this.removedThisTick.set(node, parent);
    }

    // MutationObserver only ever reports mutations within nodes connected to the observed
    // root at mutation time (§5.1), so `parent` should always already be a row here. The
    // guard is defensive, not a documented branch of the algorithm.
    const parentId = this.domNodes.keyOf(parent);
    if (parentId === NONE_DOM_NODE_KEY) return;

    this.walkSiblingRun(record.addedNodes, parentId, ops);
  }

  /**
   * §5.5 — reuse-or-create for one run of siblings under `parentId`: either a
   * `MutationRecord.addedNodes` (added together in one structural op) or a freshly-created
   * node's own `childNodes` (never observed as its own `MutationRecord` — §5.1, a subtree
   * built off-DOM then attached in one shot is invisible to the observer while detached).
   *
   * Batches each *contiguous* stretch of siblings into one `INSERT` instead of one `INSERT`
   * (and one `resolvedBefore` anchor walk) per node — contiguity is verified live via
   * `.nextSibling` right before extending a batch, never assumed from input order (which,
   * for `addedNodes`, is a snapshot a later mutation this same tick could have broken): a
   * false negative here only costs a missed batching opportunity, never correctness.
   *
   * Found empirically 2026-08-13 (`prepend-stress.html`, a block-prepend fixture — the
   * "load older messages" / virtualized-list-reorder shape): the old one-`resolvedBefore`-
   * per-node walk was O(batch²) for a single large sibling block and measured as 34% of
   * total producer CPU at a 1600-node batch. This makes it O(batch) — one anchor lookup per
   * contiguous run, not per node.
   */
  private walkSiblingRun(
    siblings: { readonly length: number; [index: number]: Node },
    parentId: DomNodeKey,
    ops: FrameOp[],
  ): void {
    const n = siblings.length;
    let i = 0;
    while (i < n) {
      const node = siblings[i]!;
      // PP-FR-1: snapshot `addedNodes` still lists nodes already destroyed later this tick.
      // Do not allocate / INSERT them. Attr/text patches already skip `!isConnected`.
      if (!node.isConnected || this.visited.has(node)) {
        i += 1;
        continue;
      }
      this.visited.add(node);
      const before = this.resolvedBefore(node);
      const batchIds: DomNodeKey[] = [];
      const firstId = this.prepareChild(node, ops);
      if (firstId !== NONE_DOM_NODE_KEY) batchIds.push(firstId);

      let prev = node;
      let j = i + 1;
      while (j < n) {
        const next = siblings[j]!;
        if (!next.isConnected || this.visited.has(next) || prev.nextSibling !== next) break;
        this.visited.add(next);
        const id = this.prepareChild(next, ops);
        if (id !== NONE_DOM_NODE_KEY) batchIds.push(id);
        prev = next;
        j += 1;
      }

      if (batchIds.length > 0) ops.push({ op: OpCode.Insert, parent: parentId, before, ids: batchIds });
      i = j;
    }
  }

  /**
   * Reuse-or-create a single node already known to belong in the caller's current `INSERT`
   * batch — `NODE_NEW` (+ its own children's ops, recursively) on the way down; the caller
   * emits the batch's `INSERT` on the way up, once, after every sibling in the run returns.
   * `NONE_DOM_NODE_KEY` means "not part of the DOM-only v0 surface" (`nodeKindOf`) — the
   * caller drops it from the batch rather than inserting a placeholder id.
   */
  private prepareChild(node: Node, ops: FrameOp[]): DomNodeKey {
    if (!node.isConnected) return NONE_DOM_NODE_KEY;
    const existingId = this.domNodes.keyOf(node);
    if (existingId !== NONE_DOM_NODE_KEY) return existingId; // reused/moved — subtree already indexed too

    const kind = nodeKindOf(node);
    if (kind === null) return NONE_DOM_NODE_KEY;

    const id = this.domNodes.allocate(node);
    this.createdThisTick.add(node);
    ops.push(describeNodeNew(id, kind, node));
    this.walkSiblingRun(node.childNodes, id, ops);
    return id;
  }

  /**
   * Nearest live next-sibling that already has a row (existing before this tick, or already
   * inserted earlier this tick). `INSERT.before` must reference a row that already exists, so
   * walking forward past not-yet-processed new siblings and inserting each one before this
   * stable anchor (left to right) reproduces live DOM order without ever forward-referencing
   * an id that doesn't exist yet.
   */
  private resolvedBefore(node: Node): DomNodeKey {
    let cur: Node | null = node.nextSibling;
    while (cur !== null) {
      const id = this.domNodes.keyOf(cur);
      if (id !== NONE_DOM_NODE_KEY) return id;
      cur = cur.nextSibling;
    }
    return INSERT_AT_END;
  }

  /**
   * §5.6 / PP-FR-1 — true detach vs move vs ephemeral, decided at drain against live DOM:
   * still `isConnected` → move (its `INSERT` already unlinked it); never had an id → ephemeral
   * (never sent); had an id and ended detached → `REMOVE`. `visited` is not a move proof.
   */
  private emitDeferredRemoves(ops: FrameOp[]): void {
    for (const [node, oldParent] of this.removedThisTick) {
      if (node.isConnected) continue;
      const id = this.domNodes.keyOf(node);
      if (id === NONE_DOM_NODE_KEY) continue;
      const oldParentId = this.domNodes.keyOf(oldParent);
      if (oldParentId === NONE_DOM_NODE_KEY) continue;
      ops.push({ op: OpCode.Remove, parent: oldParentId, ids: [id] });
    }
  }

  private emitAttrPatches(ops: FrameOp[]): void {
    for (const [node, names] of this.attrDirty) {
      if (this.createdThisTick.has(node)) continue; // NODE_NEW already hydrated current attrs
      if (!(node instanceof Element)) continue;
      const id = this.domNodes.keyOf(node);
      if (id === NONE_DOM_NODE_KEY || !node.isConnected) continue;
      const setAttrs: AttrPair[] = [];
      const delNames: string[] = [];
      for (const name of names) {
        const value = node.getAttribute(name);
        if (value === null) delNames.push(name);
        else setAttrs.push({ name, value });
      }
      if (setAttrs.length > 0) ops.push({ op: OpCode.AttrSet, node: id, attrs: setAttrs });
      if (delNames.length > 0) ops.push({ op: OpCode.AttrDel, node: id, names: delNames });
    }
  }

  private emitTextPatches(ops: FrameOp[]): void {
    for (const node of this.textDirty) {
      if (this.createdThisTick.has(node)) continue;
      const id = this.domNodes.keyOf(node);
      if (id === NONE_DOM_NODE_KEY || !node.isConnected) continue;
      ops.push({ op: OpCode.TextSet, node: id, value: node.textContent ?? '' });
    }
  }
}
