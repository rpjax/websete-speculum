/**
 * C6: author `<link rel=stylesheet>` rules paint on the owned CSSOM plane
 * (`adoptedStyleSheets`). Native href fetch on Projected is a second cascade —
 * each CSS load restyles the whole document (SPA boot flicker / H4 dual).
 *
 * Disable the native sheet via the IDL property. Do not write a `disabled`
 * attribute (not in the replicated table).
 */

export function isHtmlStylesheetLink(node: Node): node is HTMLLinkElement {
  if (node.nodeType !== 1) return false;
  const el = node as Element;
  if (el.localName.toLowerCase() !== 'link') return false;
  const link = el as HTMLLinkElement;
  try {
    if (link.relList?.contains('stylesheet')) return true;
  } catch {
    /* fall through */
  }
  const rel = (link.rel || el.getAttribute('rel') || '').toLowerCase();
  return rel.split(/\s+/).includes('stylesheet');
}

/** No-op for non-stylesheet links. Idempotent. */
export function disableProjectedNativeStylesheet(node: Node): void {
  if (!isHtmlStylesheetLink(node)) return;
  node.disabled = true;
}
