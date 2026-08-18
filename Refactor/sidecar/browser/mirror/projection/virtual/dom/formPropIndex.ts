/**
 * Producer-local form-control index — frame-protocol.md §5.9.
 * Membership only. Not hashed. Sample every tick; emit PROP_SET on change.
 */

import { OpCode } from '../../models/opcodes';
import {
  PROP_ID_CHECKED,
  PROP_ID_SELECTED,
  PROP_ID_VALUE,
  propScalarsEqual,
} from '../../models/propSet';
import type { FrameOp } from '../../models/frame';
import type { FormControlSnap } from '../../models/formControlSnap';
import type { ReplicatedTable } from '../../models/replicatedTable';
import { NONE_DOM_NODE_KEY, type DomNodeTable } from './domNodeTable';

const SKIP_INPUT_TYPES = new Set(['file', 'button', 'submit', 'reset', 'image']);

export function classifyFormControl(node: Node): { propId: number; value: string | boolean } | null {
  if (!(node instanceof Element)) return null;
  const tag = node.tagName;
  if (tag === 'TEXTAREA') {
    return { propId: PROP_ID_VALUE, value: (node as HTMLTextAreaElement).value };
  }
  if (tag === 'OPTION') {
    return { propId: PROP_ID_SELECTED, value: (node as HTMLOptionElement).selected };
  }
  if (tag !== 'INPUT') return null;
  const type = ((node as HTMLInputElement).type || 'text').toLowerCase();
  if (SKIP_INPUT_TYPES.has(type)) return null;
  if (type === 'checkbox' || type === 'radio') {
    return { propId: PROP_ID_CHECKED, value: (node as HTMLInputElement).checked };
  }
  return { propId: PROP_ID_VALUE, value: (node as HTMLInputElement).value };
}

export function isFormIndexCandidate(node: Node): boolean {
  return classifyFormControl(node) !== null;
}

export class FormPropIndex {
  private readonly nodes = new Set<Node>();

  addIfIndexed(node: Node): void {
    if (isFormIndexCandidate(node)) this.nodes.add(node);
  }

  remove(node: Node): void {
    this.nodes.delete(node);
  }

  clear(): void {
    this.nodes.clear();
  }

  rebuild(domNodes: DomNodeTable): void {
    this.nodes.clear();
    for (const [, node] of domNodes.liveEntries()) this.addIfIndexed(node);
  }

  /** Emit PROP_SET when live ≠ table.props. Drops disconnected nodes from the index. */
  sample(domNodes: DomNodeTable, table: ReplicatedTable): FrameOp[] {
    const ops: FrameOp[] = [];
    for (const node of [...this.nodes]) {
      if (!node.isConnected) {
        this.nodes.delete(node);
        continue;
      }
      const classified = classifyFormControl(node);
      if (classified === null) continue;
      const id = domNodes.keyOf(node);
      if (id === NONE_DOM_NODE_KEY) continue;
      if (propScalarsEqual(table.getProp(id, classified.propId), classified.value)) continue;
      ops.push({
        op: OpCode.PropSet,
        node: id,
        propId: classified.propId,
        value: classified.value,
      });
    }
    return ops;
  }
}

export function snapshotFormControls(doc: Document): FormControlSnap[] {
  const out: FormControlSnap[] = [];
  const nodes = doc.querySelectorAll('input, textarea, option');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i]!;
    const classified = classifyFormControl(el);
    if (classified === null) continue;
    const key = formControlKey(el);
    if (key === null) continue;
    const snap: FormControlSnap = { key };
    if (classified.propId === PROP_ID_VALUE) snap.value = String(classified.value);
    else if (classified.propId === PROP_ID_CHECKED) snap.checked = Boolean(classified.value);
    else snap.selected = Boolean(classified.value);
    out.push(snap);
  }
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

function formControlKey(el: Element): string | null {
  if (el.id) return el.id;
  if (el.tagName === 'OPTION') {
    const select = el.closest('select');
    const selectId = select?.id || '';
    const value = (el as HTMLOptionElement).value;
    if (!selectId && !value) return null;
    return `option:${selectId}:${value}`;
  }
  return null;
}
