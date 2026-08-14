/**
 * Resync — frame-protocol.md §5.8. Two primitives, one shared emission path:
 *
 * - `emitResyncFrame` — the single, uniform "describe what the identity map currently says
 *   exists" path. Two linear passes, no DOM walk: (1) over the map, `NODE_NEW` every connected
 *   row read fresh from the live node, dropping disconnected rows as a bonus GC sweep; (2) over
 *   the map again, per surviving id, one batched `INSERT` built from that node's *live*
 *   `childNodes` order — not the map's iteration order, which reflects allocation history, not
 *   current sibling order. Ids are never reallocated here. Closes with a whole-table `CHECK`
 *   (§5.8 step 4, Stage 2) — the client's swap-trigger condition (§5.8 "Client side") once
 *   Stage 4 wires the double-buffer surface.
 *
 * - `resyncVirtual` — clears the identity map (no `generation` bump — not `EPOCH_RESET`), walks
 *   the live DOM once to repopulate it with fresh ids for whatever is currently connected, then
 *   calls `emitResyncFrame`. The one deliberate exception to "ids are never reallocated": a
 *   walk-based rebuild has no prior ids worth preserving. Used by bootstrap (§5.1 — the observer
 *   does not reliably attach before the parser produces content) and, later, by mid-session
 *   recovery when the map itself is not trusted (lighter recovery uses `emitResyncFrame` alone).
 *
 * Both must run as a single synchronous JS turn — see §5.8 "Atomicity". Neither opens the door
 * to a cross-document (pierced iframe) snapshot; that remains OPEN-6, pinned.
 */

import { OpCode } from '../../models/opcodes';
import {
  CHECK_SCOPE_TABLE,
  createFrame,
  DOCUMENT_ID,
  INSERT_AT_END,
  type Frame,
  type FrameOp,
} from '../../models/frame';
import { NONE_DOM_NODE_KEY, type DomNodeKey } from '../../models/domNodeKey';
import type { DomNodeTable } from '../dom/domNodeTable';
import type { ReplicatedTable } from '../../models/replicatedTable';
import { applyOpsToTable } from '../../models/replicatedTableApply';
import { describeNodeNew, nodeKindOf } from './domNodeDescribe';

/**
 * §5.8 `emitResyncFrame` — reads the map as-is; never allocates, never walks the DOM tree.
 * `table` is reset and rebuilt wholesale from the same ops this emits (§2 flags bit1: "replaces
 * the table wholesale rather than extending it") — `preTableHash` rides the frame unchecked
 * (§2: "there is no prior state to check against a wholesale replace"), so it is written as `0n`.
 */
export function emitResyncFrame(
  domNodes: DomNodeTable,
  table: ReplicatedTable,
  generation: number,
  sequence: number,
): Frame {
  const ops: FrameOp[] = [];

  // Pass 1 — create. Connected rows are re-described fresh from the live node; disconnected rows
  // are dropped from the map (a bonus GC sweep, not a substitute for OPEN-2's deferred-age GC).
  for (const [id, node] of domNodes.liveEntries()) {
    if (id === DOCUMENT_ID) continue; // id 1 is the implicit anchor, never re-described
    if (!node.isConnected) {
      domNodes.release(node);
      continue;
    }
    const kind = nodeKindOf(node);
    if (kind === null) continue;
    ops.push(describeNodeNew(id, kind, node));
  }

  // Pass 2 — topology. Iterate the (now GC'd) map again; per surviving id, read its own live
  // `childNodes` (native order) and emit one batched INSERT. `document` (id 1) is included even
  // though it was skipped above for NODE_NEW — it still has children to place.
  for (const [id, node] of domNodes.liveEntries()) {
    const children = node.childNodes;
    if (children.length === 0) continue;
    const ids: DomNodeKey[] = [];
    for (const child of children) {
      const childId = domNodes.keyOf(child);
      if (childId === NONE_DOM_NODE_KEY) continue; // not connected / not describable — skip
      ids.push(childId);
    }
    if (ids.length > 0) ops.push({ op: OpCode.Insert, parent: id, before: INSERT_AT_END, ids });
  }

  table.reset();
  table.setSequence(sequence);
  applyOpsToTable(table, ops);

  // §5.8 step 4 — "Close. Last instruction of the frame: CHECK(scope: 0, hash: freshly computed
  // tableHash over everything just emitted)". Gives the client (and telemetry) a hard
  // verification that reconstruction is complete and correct — closes over `table.tableHash`
  // *after* the two passes above have folded every op into it.
  ops.push({ op: OpCode.Check, scope: CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: table.tableHash });

  return createFrame({ generation, sequence, ops, resync: true, preTableHash: 0n });
}

/**
 * §5.8 `resyncVirtual` — clear, walk, rebuild, emit. The only place in the whole design that
 * walks the DOM tree instead of iterating the identity map, because there is not yet a map to
 * iterate: bootstrap's identity map starts empty while the live DOM (per §5.1's corrected
 * premise) does not.
 */
export function resyncVirtual(domNodes: DomNodeTable, table: ReplicatedTable, sequence: number): Frame {
  const generation = domNodes.generation;
  domNodes.resetIdentity();
  domNodes.bind(document, DOCUMENT_ID);
  allocateConnectedSubtree(document, domNodes);
  return emitResyncFrame(domNodes, table, generation, sequence);
}

/** Depth-first allocation only — order does not matter, `emitResyncFrame` reads live sibling order. */
function allocateConnectedSubtree(root: Node, domNodes: DomNodeTable): void {
  const children = root.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (nodeKindOf(child) !== null) domNodes.allocate(child);
    allocateConnectedSubtree(child, domNodes);
  }
}
