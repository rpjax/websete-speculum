/** PP-PROP-1 capture of live form properties on a Document (lab client). */

import type { FormControlSnap } from '../core/formControlSnap';

const SKIP_INPUT_TYPES = new Set(['file', 'button', 'submit', 'reset', 'image']);

export function snapshotFormControls(doc: Document): FormControlSnap[] {
  const out: FormControlSnap[] = [];
  const nodes = doc.querySelectorAll('input, textarea, option');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i]!;
    const snap = snapshotOne(el);
    if (snap) out.push(snap);
  }
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

function snapshotOne(el: Element): FormControlSnap | null {
  const tag = el.tagName;
  if (tag === 'TEXTAREA') {
    const key = el.id || null;
    if (!key) return null;
    return { key, value: (el as HTMLTextAreaElement).value };
  }
  if (tag === 'OPTION') {
    const select = el.closest('select');
    const selectId = select?.id || '';
    const value = (el as HTMLOptionElement).value;
    if (!selectId && !value) return null;
    return { key: `option:${selectId}:${value}`, selected: (el as HTMLOptionElement).selected };
  }
  if (tag !== 'INPUT') return null;
  const input = el as HTMLInputElement;
  const type = (input.type || 'text').toLowerCase();
  if (SKIP_INPUT_TYPES.has(type)) return null;
  const key = el.id || null;
  if (!key) return null;
  if (type === 'checkbox' || type === 'radio') return { key, checked: input.checked };
  return { key, value: input.value };
}
