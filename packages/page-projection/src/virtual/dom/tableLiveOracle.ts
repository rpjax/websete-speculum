/**
 * Virtual-side O2 local walk — live childNodes × identity map, then models/tableLiveOracle.
 * Lab-only; called from __speculumProjection.compareTableToLiveDom (not the tick loop).
 */

import { DOCUMENT_ID } from '../../core/frame';
import { NONE_DOM_NODE_KEY } from '../../core/domNodeKey';
import { compareTableToLiveOrder, type TableLiveOracleResult } from '../../core/tableLiveOracle';
import type { ReplicatedTable } from '../../core/replicatedTable';
import type { DomNodeTable } from './domNodeTable';
import { nodeKindOf } from './domNodeDescribe';
import { admissibleShadowRoot } from './shadowAdmit';

export function compareTableToLiveDom(
  table: ReplicatedTable,
  domNodes: DomNodeTable,
  root: Document,
): TableLiveOracleResult {
  const liveChildren = new Map<number, number[]>();

  const visit = (node: Node, id: number): void => {
    const kids: number[] = [];
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (nodeKindOf(child) === null) continue;
      const childId = domNodes.keyOf(child);
      if (childId === NONE_DOM_NODE_KEY) continue;
      kids.push(childId);
      visit(child, childId);
    }
    if (node instanceof Element) {
      const sr = admissibleShadowRoot(node);
      if (sr !== null) {
        const rootId = domNodes.keyOf(sr);
        if (rootId !== NONE_DOM_NODE_KEY) visit(sr, rootId);
      }
    }
    liveChildren.set(id, kids);
  };

  visit(root, DOCUMENT_ID);
  const result = compareTableToLiveOrder(table, liveChildren);
  if (result.identical) return result;
  return {
    ...result,
    divergences: result.divergences.map((d) => {
      if (d.kind !== 'extra_attached_in_table' && d.kind !== 'missing_in_table' && d.kind !== 'detached_but_connected') {
        return d;
      }
      const id = Number(d.path.slice(1));
      const node = Number.isFinite(id) ? domNodes.get(id) : undefined;
      if (node === undefined) return { ...d, details: `${d.details}; identity=missing` };
      return {
        ...d,
        details: `${d.details}; nodeType=${node.nodeType} name=${node.nodeName} connected=${node.isConnected} parent=${node.parentNode?.nodeName ?? 'null'}`,
      };
    }),
  };
}
