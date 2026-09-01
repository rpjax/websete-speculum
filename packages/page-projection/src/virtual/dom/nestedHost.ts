/**
 * Nested browsing-context host — admit by tag on the wire; window lookup is separate.
 */

export { isNestedHostNavAttr } from '../../core/nestedNav';

/** Producer admit + NODE_NEW nestedHost mark — tag only; window may come later (Projected waits on load). */
export function isNestedBrowsingHost(node: Node): boolean {
  if (node.nodeType !== 1) return false;
  if (!node.isConnected) return false;
  const tag = (node as Element).localName.toLowerCase();
  return tag === 'iframe' || tag === 'object' || tag === 'embed';
}

/** Input / hit-test — host row must expose a live browsing context. */
export function hasNestedBrowsingContextWindow(node: Node): boolean {
  if (!isNestedBrowsingHost(node)) return false;
  const cw = (node as Node & { contentWindow?: Window | null }).contentWindow;
  return cw != null;
}
