/**
 * Structural (topology-only) DOM snapshot — no pixels, no CSSOM, matching the core-DOM-only
 * scope this lab increment validates. Self-contained at runtime (only a type-only import,
 * erased before emit): this function is called two ways —
 *   1. bundled standalone (`npm run build:snapshot`) and injected into the Virtual Chromium
 *      page as a string via `page.evaluate` (`lab/virtualSnapshot.ts`) — kept in this
 *      DOM-typed, esbuild-only module rather than `lab/` because `lib.dom.d.ts`'s global
 *      `Node`/`Element` types collide with an unrelated legacy `Node` type already used
 *      elsewhere in this repo's tsc-checked graph (`browser/patchright/mirror/...`);
 *   2. imported directly into `lab/client/main.ts` and called against the surface iframe's
 *      `contentDocument`.
 */

import type { TreeNode } from '../treeNode';
import { elementNsSnapshotLabel } from '../elementNs';
import { resolveShadowRoot } from '../closedShadowLookup';

/** `root` defaults to the calling context's own `document` — the case `page.evaluate` needs. */
export function snapshotTree(root?: Node): TreeNode {
  return walkNode(root ?? document);
}

function walkNode(node: Node): TreeNode {
  switch (node.nodeType) {
    case 9: // Document
      return { tag: '#document', children: mapChildren(node) };
    case 10: { // DocumentType
      const dt = node as DocumentType;
      return { tag: '#doctype', text: dt.name };
    }
    case 1: { // Element
      const el = node as Element;
      const attrs: [string, string][] = [];
      const host = (el as HTMLElement & { contentWindow?: Window | null }).contentWindow != null;
      for (let i = 0; i < el.attributes.length; i++) {
        const a = el.attributes[i]!;
        if (host && (a.name === 'src' || a.name === 'srcdoc')) continue;
        attrs.push([a.name, a.value]);
      }
      attrs.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
      const result: TreeNode = { tag: el.tagName.toLowerCase() };
      const ns = elementNsSnapshotLabel(el.namespaceURI);
      if (ns !== undefined) result.ns = ns;
      if (attrs.length > 0) result.attrs = attrs;
      const children = mapChildren(node);
      if (children.length > 0) result.children = children;
      const sr = resolveShadowRoot(el);
      if (sr !== null && sr.slotAssignment !== 'manual') {
        const shadowKids = mapChildren(sr);
        result.shadow = { tag: '#shadow-root', ...(shadowKids.length > 0 ? { children: shadowKids } : {}) };
      }
      if (host) {
        try {
          const iframe = el as HTMLIFrameElement;
          const win = iframe.contentWindow;
          if (win) result.frameHref = win.location.href;
          const inner = iframe.contentDocument;
          if (inner) result.nested = walkNode(inner);
        } catch {
          /* cross-origin — no inner snapshot */
        }
      }
      return result;
    }
    case 3: // Text
      return { tag: '#text', text: node.textContent ?? '' };
    case 8: // Comment
      return { tag: '#comment', text: node.textContent ?? '' };
    default:
      return { tag: `#unknown(${node.nodeType})` };
  }
}

function mapChildren(node: Node): TreeNode[] {
  const out: TreeNode[] = [];
  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) out.push(walkNode(children[i]!));
  return out;
}
