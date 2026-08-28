/**
 * Nested browsing-context host — classify with `contentWindow != null`, not `.contentDocument`.
 */

export { isNestedHostNavAttr } from '../../core/nestedNav';

export function isNestedBrowsingHost(node: Node): boolean {
  if (node.nodeType !== 1) return false;
  if (!node.isConnected) return false;
  const cw = (node as Node & { contentWindow?: Window | null }).contentWindow;
  return cw != null;
}
