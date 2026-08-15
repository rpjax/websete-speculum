/**
 * Virtual-side O2 local walk — live childNodes × identity map, then models/tableLiveOracle.
 * Lab-only; called from __speculumProjection.compareTableToLiveDom (not the tick loop).
 */

import { DOCUMENT_ID } from '../../models/frame';
import { NONE_DOM_NODE_KEY } from '../../models/domNodeKey';
import { compareTableToLiveOrder, type TableLiveOracleResult } from '../../models/tableLiveOracle';
import type { ReplicatedTable } from '../../models/replicatedTable';
import type { DomNodeTable } from './domNodeTable';
import { nodeKindOf } from './domNodeDescribe';

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
