/**
 * F-visible child walk + flush-time snapshots for live frames (§5.2 / §5.3.3).
 * Main-document DOM seal — pierce deferred.
 */

import type { DomNodeKey } from '../../models/domNodeKey';
import type { DomNodeSnapshot } from '../../models/frame';
import type { DomNodeTable } from '../dom/domNodeTable';

/** Tags published as empty hosts (no interior). */
const PLACEHOLDER_TAGS = new Set([
  'script',
  'noscript',
  'template',
  'iframe',
  'base',
  'object',
  'embed',
  'applet',
]);

const DENY_ATTR = new Set(['integrity']);

export function isPlaceholderTag(tag: string): boolean {
  return PLACEHOLDER_TAGS.has(tag.toLowerCase());
}

export function isFVisibleNode(node: Node): boolean {
  const t = node.nodeType;
  return (
    t === Node.ELEMENT_NODE ||
    t === Node.TEXT_NODE ||
    t === Node.COMMENT_NODE
  );
}

export function isPublishableNode(node: Node): boolean {
  return isFVisibleNode(node);
}

export function listFVisibleChildren(parent: Node): Node[] {
  const out: Node[] = [];
  if (parent.nodeType === Node.ELEMENT_NODE) {
    const tag = (parent as Element).tagName.toLowerCase();
    if (isPlaceholderTag(tag)) return out;
  }
  const kids = parent.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i]!;
    if (isFVisibleNode(n)) out.push(n);
  }
  return out;
}

function isDeniedAttr(name: string, value: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith('on')) return true;
  if (DENY_ATTR.has(lower)) return true;
  if (value.trimStart().toLowerCase().startsWith('javascript:')) return true;
  return false;
}

export function snapshotAttrs(el: Element): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs[i]!;
    if (isDeniedAttr(a.name, a.value)) continue;
    out.push({ name: a.name, value: a.value });
  }
  return out;
}

export function snapshotNodeFlat(key: DomNodeKey, node: Node): DomNodeSnapshot | null {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    return {
      kind: 'element',
      key,
      tag: el.tagName.toLowerCase(),
      attrs: snapshotAttrs(el),
    };
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return { kind: 'text', key, value: (node as Text).data };
  }
  if (node.nodeType === Node.COMMENT_NODE) {
    return { kind: 'comment', key, value: (node as Comment).data };
  }
  return null;
}

export function snapshotNodeSubtree(
  key: DomNodeKey,
  node: Node,
  domNodes: DomNodeTable,
  onKey?: (k: DomNodeKey) => void,
): DomNodeSnapshot | null {
  onKey?.(key);
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    const children: DomNodeSnapshot[] = [];
    const kids = listFVisibleChildren(el);
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i]!;
      const childKey = domNodes.allocate(child);
      const snap = snapshotNodeSubtree(childKey, child, domNodes, onKey);
      if (snap !== null) children.push(snap);
    }
    return {
      kind: 'element',
      key,
      tag: el.tagName.toLowerCase(),
      attrs: snapshotAttrs(el),
      children,
    };
  }
  return snapshotNodeFlat(key, node);
}

export function documentOrderCompare(a: Node, b: Node): number {
  if (a === b) return 0;
  const pos = a.compareDocumentPosition(b);
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

/** Escape attribute value for establish HTML. */
export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
