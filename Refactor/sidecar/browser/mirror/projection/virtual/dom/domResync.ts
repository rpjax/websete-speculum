/**
 * DOM-plane contribution to a resync frame (§5.8 two-pass describe).
 * Does not close CHECK, does not touch CSSOM — {@link ../resync.ts} orchestrates the system frame.
 */

import { NodeKind, OpCode } from '../../models/opcodes';
import { DOCUMENT_ID, INSERT_AT_END, type FrameOp } from '../../models/frame';
import { NONE_DOM_NODE_KEY, type DomNodeKey } from '../../models/domNodeKey';
import type { DomNodeTable } from './domNodeTable';
import { describeNodeNew, nodeKindOf } from './domNodeDescribe';
import type { FormPropIndex } from './formPropIndex';
import { admissibleShadowRoot } from './shadowAdmit';

/** Clear identity (no generation bump) and allocate every connected describable node. */
export function rebuildDomIdentity(domNodes: DomNodeTable, root: Node = document): void {
  domNodes.resetIdentity();
  domNodes.bind(root, DOCUMENT_ID);
  allocateConnectedSubtree(root, domNodes);
}

/**
 * Pass 1 `NODE_NEW` + pass 2 `INSERT` from live `childNodes` (and `shadowRoot.childNodes`).
 * Never `INSERT`s the `SHADOW_ROOT` under the host. Releases disconnected map rows.
 * Caller resets/applies the replicated table and appends CHECK.
 */
export function describeDomResync(domNodes: DomNodeTable, formIndex: FormPropIndex): FrameOp[] {
  const ops: FrameOp[] = [];
  formIndex.rebuild(domNodes);

  for (const [id, node] of domNodes.liveEntries()) {
    if (id === DOCUMENT_ID) continue;
    if (!node.isConnected) {
      domNodes.release(node);
      continue;
    }
    const kind = nodeKindOf(node);
    if (kind === null) continue;
    if (kind === NodeKind.ShadowRoot) {
      const hostId = domNodes.keyOf((node as ShadowRoot).host);
      if (hostId === NONE_DOM_NODE_KEY) continue;
      ops.push(describeNodeNew(id, kind, node, hostId));
      continue;
    }
    ops.push(describeNodeNew(id, kind, node));
  }

  for (const [id, node] of domNodes.liveEntries()) {
    if (node instanceof ShadowRoot) {
      pushChildInsert(ops, id, node.childNodes, domNodes);
      continue;
    }
    const children = node.childNodes;
    if (children.length === 0) continue;
    pushChildInsert(ops, id, children, domNodes);
  }

  return ops;
}

function pushChildInsert(
  ops: FrameOp[],
  parent: DomNodeKey,
  children: NodeListOf<ChildNode>,
  domNodes: DomNodeTable,
): void {
  const ids: DomNodeKey[] = [];
  for (const child of children) {
    const childId = domNodes.keyOf(child);
    if (childId === NONE_DOM_NODE_KEY) continue;
    ids.push(childId);
  }
  if (ids.length > 0) ops.push({ op: OpCode.Insert, parent, before: INSERT_AT_END, ids });
}

function allocateConnectedSubtree(root: Node, domNodes: DomNodeTable): void {
  const children = root.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (nodeKindOf(child) !== null) domNodes.allocate(child);
    allocateConnectedSubtree(child, domNodes);
  }
  if (root instanceof Element) {
    const sr = admissibleShadowRoot(root);
    if (sr !== null) {
      domNodes.allocate(sr);
      allocateConnectedSubtree(sr, domNodes);
    }
  }
}
