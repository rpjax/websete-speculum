/**
 * Structural (topology-only) diff between a Virtual snapshot and a Client snapshot —
 * `TreeNode` shapes from `projected/domTreeSnapshot.ts` (Virtual tree via coherent
 * `getStateSnapshot({ includeTree })` / `snapshotEvaluate`; Projected via client snapshot).
 *
 * **Comparison boundary (O2 lab oracle):**
 * - Virtual = live Chromium DOM; Client = Projected srcdoc document after wire apply.
 * - Parser scaffold on the Client (srcdoc-only nodes not present on Virtual) is excluded
 *   by structural shape, not by tag/name allowlists — see `isParserScaffoldNode`.
 * - URL-bearing attributes are normalized through the same virtual-asset rewrite the
 *   projection path uses (`classifyAndRewriteUrl` / `httpUrlToVirtual`) so rewritten
 *   `/w7s/virtual-assets/…` compares equal to Virtual `/path` or absolute http(s).
 * - `style` on `<html>` is surface presentation on the Projected shell — omitted from attr compare.
 * - `frameHref` is never compared (see `treeNode.ts`).
 *
 * Children are aligned by structural fingerprint (not index) so a single parser-inserted
 * head node does not shift the entire subtree.
 */

import type { TreeNode } from '@speculum/page-projection/core/treeNode';
import {
  URL_ATTR_NAMES,
  absolutizeUrl,
  classifyAndRewriteUrl,
  httpUrlToVirtual,
  VIRTUAL_ASSETS_PREFIX,
} from '../../assets/urlForms';
import {
  SessionAuthQueryParam,
  SessionCacheBustQueryParam,
} from '@speculum/page-projection/projected/sessionBindingAuth';

export type DivergenceKind =
  | 'tag_mismatch'
  | 'ns_mismatch'
  | 'attr_mismatch'
  | 'text_mismatch'
  | 'child_count_mismatch'
  | 'extra_node'
  | 'missing_node';

export type Divergence = {
  path: string;
  kind: DivergenceKind;
  details: string;
};

export type StructuralDiffResult = {
  kind: 'structural';
  identical: boolean;
  divergenceCount: number;
  /** Capped at MAX_DIVERGENCES — divergenceCount above is the uncapped truth. */
  divergences: Divergence[];
};

export type StructuralDiffOptions = {
  /** Page URL used to absolutize relative Virtual paths before virtual-asset rewrite. */
  pageBaseUrl?: string;
};

const MAX_DIVERGENCES = 50;

const RESERVED_QUERY_PARAMS = new Set([SessionAuthQueryParam, SessionCacheBustQueryParam]);

/** Number of open-shadow trees in the snapshot (hosts, including nested). Light-only = 0. */
export function countShadowTrees(node: TreeNode): number {
  let n = 0;
  if (node.shadow !== undefined) n += 1 + countShadowTrees(node.shadow);
  if (node.nested !== undefined) n += countShadowTrees(node.nested);
  const children = node.children ?? [];
  for (let i = 0; i < children.length; i++) n += countShadowTrees(children[i]!);
  return n;
}

/** Nested browsing-context documents captured in the snapshot (SO `contentDocument`). */
export function countNestedDocuments(node: TreeNode): number {
  let n = 0;
  if (node.nested !== undefined) n += 1 + countNestedDocuments(node.nested);
  if (node.shadow !== undefined) n += countNestedDocuments(node.shadow);
  const children = node.children ?? [];
  for (let i = 0; i < children.length; i++) n += countNestedDocuments(children[i]!);
  return n;
}

export function collectFrameHrefs(node: TreeNode, out: string[] = []): string[] {
  if (node.frameHref) out.push(node.frameHref);
  if (node.nested) collectFrameHrefs(node.nested, out);
  if (node.shadow) collectFrameHrefs(node.shadow, out);
  const children = node.children ?? [];
  for (let i = 0; i < children.length; i++) collectFrameHrefs(children[i]!, out);
  return out;
}

export function diffTrees(
  virtual: TreeNode,
  client: TreeNode,
  options: StructuralDiffOptions = {},
): StructuralDiffResult {
  const pageBaseUrl = options.pageBaseUrl?.trim() || inferPageBaseUrl(virtual, client);
  const divergences: Divergence[] = [];
  let count = 0;
  const record = (path: string, kind: DivergenceKind, details: string): void => {
    count += 1;
    if (divergences.length < MAX_DIVERGENCES) divergences.push({ path, kind, details });
  };
  walk(virtual, client, '#document', pageBaseUrl, record);
  return { kind: 'structural', identical: count === 0, divergenceCount: count, divergences };
}

function inferPageBaseUrl(virtual: TreeNode, client: TreeNode): string {
  const hrefs = [...collectFrameHrefs(virtual), ...collectFrameHrefs(client)];
  for (const href of hrefs) {
    if (/^https?:\/\//i.test(href)) return href;
  }
  return 'https://speculum.invalid/';
}

function walk(
  a: TreeNode | undefined,
  b: TreeNode | undefined,
  path: string,
  pageBaseUrl: string,
  record: (path: string, kind: DivergenceKind, details: string) => void,
): void {
  if (a === undefined && b === undefined) return;
  if (a === undefined) {
    if (b !== undefined && isParserScaffoldNode(b, path)) return;
    record(path, 'extra_node', `client has <${describe(b!)}>, virtual has none`);
    return;
  }
  if (b === undefined) {
    record(path, 'missing_node', `virtual has <${describe(a)}>, client has none`);
    return;
  }
  if (a.tag !== b.tag) {
    record(path, 'tag_mismatch', `virtual=${a.tag} client=${b.tag}`);
    return;
  }
  const aNs = a.ns ?? 'html';
  const bNs = b.ns ?? 'html';
  if (aNs !== bNs) {
    record(path, 'ns_mismatch', `virtual=${aNs} client=${bNs}`);
    return;
  }
  if ((a.text ?? '') !== (b.text ?? '')) {
    record(path, 'text_mismatch', `virtual=${JSON.stringify(a.text)} client=${JSON.stringify(b.text)}`);
  }
  const attrDetails = diffAttrs(a, b, path, pageBaseUrl);
  if (attrDetails !== null) record(path, 'attr_mismatch', attrDetails);

  const aChildren = filterParserScaffoldChildren(a.children ?? [], path, 'virtual');
  const bChildren = filterParserScaffoldChildren(b.children ?? [], path, 'client');
  const pairs = alignChildrenByFingerprint(aChildren, bChildren, pageBaseUrl);
  if (pairs.unmatchedVirtual.length > 0 || pairs.unmatchedClient.length > 0) {
    const v = aChildren.length;
    const c = bChildren.length;
    if (v !== c) {
      record(path, 'child_count_mismatch', `virtual=${v} client=${c}`);
    }
  }
  for (const [ai, bi, idx] of pairs.pairs) {
    const childTag = aChildren[ai]?.tag ?? bChildren[bi]?.tag ?? `#${idx}`;
    walk(aChildren[ai], bChildren[bi], `${path}>${childTag}[${idx}]`, pageBaseUrl, record);
  }
  for (const ai of pairs.unmatchedVirtual) {
    const child = aChildren[ai]!;
    record(`${path}>${child.tag}[${ai}]`, 'missing_node', `virtual has <${describe(child)}>, client has none`);
  }
  for (const bi of pairs.unmatchedClient) {
    const child = bChildren[bi]!;
    if (isParserScaffoldNode(child, `${path}>${child.tag}[${bi}]`)) continue;
    record(`${path}>${child.tag}[${bi}]`, 'extra_node', `client has <${describe(child)}>, virtual has none`);
  }

  if (a.shadow !== undefined || b.shadow !== undefined) {
    walk(a.shadow, b.shadow, `${path}>${a.tag}::shadow`, pageBaseUrl, record);
  }
  if (a.nested !== undefined || b.nested !== undefined) {
    walk(a.nested, b.nested, `${path}>${a.tag}::nested`, pageBaseUrl, record);
  }
}

function isUnderHtmlHead(path: string): boolean {
  return />head(?:\[\d+])?(?:>|$)/.test(path);
}

/**
 * Parser scaffold: leaf element under `html>head` with no subtree, produced only on the
 * Projected srcdoc document (charset/link boilerplate the HTML parser inserts). Structural
 * predicate — no tag-name table.
 */
function isParserScaffoldNode(node: TreeNode, path: string): boolean {
  if (!isUnderHtmlHead(path)) return false;
  if (node.shadow !== undefined || node.nested !== undefined) return false;
  const children = node.children ?? [];
  if (children.length > 0) return false;
  if (node.text !== undefined && node.text.length > 0) return false;
  const attrs = node.attrs ?? [];
  if (attrs.length === 0 || attrs.length > 2) return false;
  return attrs.every(([, v]) => v.length <= 64);
}

function filterParserScaffoldChildren(
  children: TreeNode[],
  parentPath: string,
  side: 'virtual' | 'client',
): TreeNode[] {
  if (side !== 'client') return children;
  return children.filter((child, i) => !isParserScaffoldNode(child, `${parentPath}>${child.tag}[${i}]`));
}

type ChildAlignment = {
  pairs: Array<[number, number, number]>;
  unmatchedVirtual: number[];
  unmatchedClient: number[];
};

function alignChildrenByFingerprint(
  aChildren: TreeNode[],
  bChildren: TreeNode[],
  pageBaseUrl: string,
): ChildAlignment {
  const pairs: Array<[number, number, number]> = [];
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  let pairIdx = 0;

  for (let ai = 0; ai < aChildren.length; ai++) {
    const fpA = childFingerprint(aChildren[ai]!, pageBaseUrl);
    for (let bi = 0; bi < bChildren.length; bi++) {
      if (usedB.has(bi)) continue;
      if (fpA === childFingerprint(bChildren[bi]!, pageBaseUrl)) {
        usedA.add(ai);
        usedB.add(bi);
        pairs.push([ai, bi, pairIdx++]);
        break;
      }
    }
  }

  const unmatchedVirtual: number[] = [];
  const unmatchedClient: number[] = [];
  for (let ai = 0; ai < aChildren.length; ai++) if (!usedA.has(ai)) unmatchedVirtual.push(ai);
  for (let bi = 0; bi < bChildren.length; bi++) if (!usedB.has(bi)) unmatchedClient.push(bi);
  return { pairs, unmatchedVirtual, unmatchedClient };
}

function childFingerprint(node: TreeNode, pageBaseUrl: string): string {
  const attrs = normalizeAttrs(node, '#child', pageBaseUrl)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('|');
  return `${node.tag}|${node.ns ?? 'html'}|${node.text ?? ''}|${attrs}`;
}

function normalizeAttrs(
  node: TreeNode,
  path: string,
  pageBaseUrl: string,
): [string, string][] {
  const out: [string, string][] = [];
  for (const [name, value] of node.attrs ?? []) {
    const lower = name.toLowerCase();
    if (node.tag === 'html' && lower === 'style') continue;
    if (URL_ATTR_NAMES.has(lower)) {
      out.push([lower, normalizeUrlAttrValue(value, pageBaseUrl)]);
      continue;
    }
    out.push([lower, value]);
  }
  out.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return out;
}

/** Canonical virtual-asset path (no session/cache-bust query) for structural URL compare. */
export function normalizeUrlAttrValue(raw: string, pageBaseUrl: string): string {
  const t = raw.trim();
  if (!t) return t;
  const stripped = stripReservedQueryParams(t);
  if (stripped.startsWith(VIRTUAL_ASSETS_PREFIX)) {
    return stripped.split('?')[0]!;
  }
  const abs = absolutizeUrl(stripped, pageBaseUrl);
  const rewritten = classifyAndRewriteUrl(abs, pageBaseUrl);
  if (rewritten.kind === 'http') return rewritten.value.split('?')[0]!;
  if (rewritten.kind === 'data' || rewritten.kind === 'blob') return rewritten.value;
  if (/^https?:\/\//i.test(abs)) {
    const virtual = httpUrlToVirtual(abs);
    if (virtual) return virtual.split('?')[0]!;
    return abs;
  }
  if (stripped.startsWith('/')) {
    try {
      const fromBase = new URL(stripped, pageBaseUrl).href;
      const virtual = httpUrlToVirtual(fromBase);
      if (virtual) return virtual.split('?')[0]!;
    } catch {
      /* keep raw */
    }
  }
  return stripped;
}

function stripReservedQueryParams(url: string): string {
  const hashAt = url.indexOf('#');
  const fragment = hashAt >= 0 ? url.slice(hashAt) : '';
  const withoutFragment = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const queryAt = withoutFragment.indexOf('?');
  if (queryAt < 0) return url;
  const path = withoutFragment.slice(0, queryAt);
  const query = withoutFragment.slice(queryAt + 1);
  const kept = query
    .split('&')
    .filter((part) => {
      const eq = part.indexOf('=');
      const name = eq >= 0 ? part.slice(0, eq) : part;
      return !RESERVED_QUERY_PARAMS.has(decodeURIComponent(name));
    })
    .join('&');
  return `${path}${kept ? `?${kept}` : ''}${fragment}`;
}

function diffAttrs(
  a: TreeNode,
  b: TreeNode,
  path: string,
  pageBaseUrl: string,
): string | null {
  const am = new Map(normalizeAttrs(a, path, pageBaseUrl));
  const bm = new Map(normalizeAttrs(b, path, pageBaseUrl));
  const parts: string[] = [];
  for (const [k, v] of am) {
    if (!bm.has(k)) parts.push(`-${k}`);
    else if (bm.get(k) !== v) parts.push(`~${k} (virtual=${v} client=${bm.get(k)})`);
  }
  for (const [k] of bm) {
    if (!am.has(k)) parts.push(`+${k}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

function describe(node: TreeNode): string {
  return node.tag + (node.text !== undefined ? `:${JSON.stringify(node.text)}` : '');
}
