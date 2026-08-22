/**
 * Admit an open named ShadowRoot for this instance — [shadow.md](shadow.md).
 * Closed / UA / `slotAssignment === 'manual'` are NIT (skip, never emit).
 */

import {
  SHADOW_INIT_CLONABLE,
  SHADOW_INIT_DELEGATES_FOCUS,
  SHADOW_INIT_SERIALIZABLE,
} from '../../core/frame';

export function admissibleShadowRoot(el: Element): ShadowRoot | null {
  const sr = el.shadowRoot;
  if (sr == null) return null;
  if (sr.mode !== 'open') return null;
  if (sr.slotAssignment === 'manual') return null;
  return sr;
}

export function shadowInitFlags(sr: ShadowRoot): number {
  let flags = 0;
  if (sr.delegatesFocus) flags |= SHADOW_INIT_DELEGATES_FOCUS;
  const extra = sr as ShadowRoot & { clonable?: boolean; serializable?: boolean };
  if (extra.clonable === true) flags |= SHADOW_INIT_CLONABLE;
  if (extra.serializable === true) flags |= SHADOW_INIT_SERIALIZABLE;
  return flags;
}

/** DFS of `root` (Document or a subtree) collecting admissible open named shadows. */
export function collectAdmittedShadowRoots(root: Node): ShadowRoot[] {
  const out: ShadowRoot[] = [];
  const visit = (node: Node): void => {
    if (node instanceof Element) {
      const sr = admissibleShadowRoot(node);
      if (sr !== null) {
        out.push(sr);
        visit(sr);
      }
    }
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) visit(children[i]!);
  };
  visit(root);
  return out;
}
