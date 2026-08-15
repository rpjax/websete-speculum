/**
 * DOM-plane contribution to a resync frame (§5.8 two-pass describe).
 * Does not close CHECK, does not touch CSSOM — {@link ../resync.ts} orchestrates the system frame.
 */

import { OpCode } from '../../models/opcodes';
import { DOCUMENT_ID, INSERT_AT_END, type FrameOp } from '../../models/frame';
import { NONE_DOM_NODE_KEY, type DomNodeKey } from '../../models/domNodeKey';
import type { DomNodeTable } from './domNodeTable';
import { describeNodeNew, nodeKindOf } from './domNodeDescribe';

/** Clear identity (no generation bump) and allocate every connected describable node. */
export function rebuildDomIdentity(domNodes: DomNodeTable, root: Node = document): void {
  domNodes.resetIdentity();
  domNodes.bind(root, DOCUMENT_ID);
  allocateConnectedSubtree(root, domNodes);
}

/**
 * Pass 1 `NODE_NEW` + pass 2 `INSERT` from live `childNodes`. Releases disconnected map rows.
 * Caller resets/applies the replicated table and appends CHECK.
 */
export function describeDomResync(domNodes: DomNodeTable): FrameOp[] {
  const ops: FrameOp[] = [];

  for (const [id, node] of domNodes.liveEntries()) {
    if (id === DOCUMENT_ID) continue;
    if (!node.isConnected) {
      domNodes.release(node);
      continue;
    }
    const kind = nodeKindOf(node);
    if (kind === null) continue;
    ops.push(describeNodeNew(id, kind, node));
  }

  for (const [id, node] of domNodes.liveEntries()) {
    const children = node.childNodes;
    if (children.length === 0) continue;
    const ids: DomNodeKey[] = [];
    for (const child of children) {
      const childId = domNodes.keyOf(child);
      if (childId === NONE_DOM_NODE_KEY) continue;
      ids.push(childId);
    }
    if (ids.length > 0) ops.push({ op: OpCode.Insert, parent: id, before: INSERT_AT_END, ids });
  }

  return ops;
}

function allocateConnectedSubtree(root: Node, domNodes: DomNodeTable): void {
  const children = root.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (nodeKindOf(child) !== null) domNodes.allocate(child);
    allocateConnectedSubtree(child, domNodes);
  }
}
