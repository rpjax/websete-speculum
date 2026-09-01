/**
 * Structural (topology-only) diff between a Virtual snapshot and a Client snapshot —
 * `TreeNode` shapes from `projected/domTreeSnapshot.ts` (Virtual tree via coherent
 * `getStateSnapshot({ includeTree })` / `snapshotEvaluate`; Projected via client snapshot).
 *
 * **Comparison boundary (O2 lab tree×tree):**
 * - Virtual = live Chromium DOM; Client = Projected srcdoc document after wire apply.
 * - Projected shell nodes that exist only on the Client (srcdoc chrome not present on
 *   Virtual) are excluded **after** fingerprint alignment, by structural shape under
 *   `html>head` — leaf, no text/shadow/nested, compact attr payload. No tag/name
 *   allowlist and no site allowlist. Pre-filter is forbidden (it drops real metas that
 *   would have matched).
 * - URL-bearing attributes are normalized through the same virtual-asset rewrite the
 *   projection path uses (`classifyAndRewriteUrl` / `httpUrlToVirtual`). Absolute
 *   Projected-origin URLs that already point at `/w7s/virtual-*` are peeled to the
 *   path form — never double-rewritten.
 * - `style` on `html` / `body` (Projected surface chrome: touch-action etc.) is outside
 *   this boundary — omitted from attr compare by element role, not by site. `frameHref`
 *   is never compared (see `treeNode.ts`).
 *
 * Children are aligned by structural fingerprint (not index) so a single shell-inserted
 * head node does not shift the entire subtree.
 */

import type { TreeNode } from '@speculum/page-projection/core/treeNode';
import {
  URL_ATTR_NAMES,
  VIRTUAL_ASSETS_PREFIX,
  VIRTUAL_BLOB_PREFIX,
  VIRTUAL_DATA_PREFIX,
  absolutizeUrl,
  classifyAndRewriteUrl,
  httpUrlToVirtual,
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

const VIRTUAL_PATH_PREFIXES = [VIRTUAL_ASSETS_PREFIX, VIRTUAL_BLOB_PREFIX, VIRTUAL_DATA_PREFIX] as const;

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
  const fromAssets = inferPageBaseFromVirtualAssetAttrs(client) ?? inferPageBaseFromVirtualAssetAttrs(virtual);
  if (fromAssets) return fromAssets;
  return 'https://speculum.invalid/';
}

/** Recover page base from rewritten `/w7s/virtual-assets/{host}{path}` attrs when frameHref is absent. Majority host first, then document-like path over static assets. */
function inferPageBaseFromVirtualAssetAttrs(node: TreeNode): string | null {
  const keys: string[] = [];
  walkAttrsForPageBase(node, (value) => {
    const peeled = peelVirtualAssetPath(stripReservedQueryParams(value));
    if (!peeled?.startsWith(VIRTUAL_ASSETS_PREFIX)) return;
    const key = peeled.slice(VIRTUAL_ASSETS_PREFIX.length);
    if (key.indexOf('/') > 0) keys.push(key);
  });
  if (keys.length === 0) return null;

  const hostCounts = new Map<string, number>();
  for (const key of keys) {
    const host = key.slice(0, key.indexOf('/'));
    if (!host.includes('.')) continue;
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
  }
  let majorityHost: string | null = null;
  let majorityCount = 0;
  for (const [host, count] of hostCounts) {
    if (count > majorityCount) {
      majorityHost = host;
      majorityCount = count;
    }
  }
  if (!majorityHost) return null;

  let best: { base: string; score: number } | null = null;
  for (const key of keys) {
    if (!key.startsWith(`${majorityHost}/`)) continue;
    const path = key.slice(majorityHost.length); // begins with /
    const score = scoreVirtualAssetKey(key);
    let dir = path;
    if (!dir.endsWith('/')) {
      const lastSlash = dir.lastIndexOf('/');
      dir = lastSlash >= 0 ? dir.slice(0, lastSlash + 1) : '/';
    }
    const base = `https://${majorityHost}${dir || '/'}`;
    if (!best || score > best.score) best = { base, score };
  }
  return best?.base ?? `https://${majorityHost}/`;
}

function scoreVirtualAssetKey(key: string): number {
  const path = key.includes('/') ? key.slice(key.indexOf('/')) : '/';
  let score = path.length;
  if (path.endsWith('/')) score += 100;
  if (/\.(ico|png|jpe?g|gif|svg|webp|js|mjs|css|woff2?|map|json)(\?|$)/i.test(path)) score -= 80;
  else score += 50;
  return score;
}

function walkAttrsForPageBase(node: TreeNode, consider: (value: string) => void): void {
  for (const [, value] of node.attrs ?? []) consider(value);
  for (const child of node.children ?? []) walkAttrsForPageBase(child, consider);
  if (node.shadow) walkAttrsForPageBase(node.shadow, consider);
  if (node.nested) walkAttrsForPageBase(node.nested, consider);
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
    if (b !== undefined && isClientShellScaffoldNode(b, path)) return;
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

  const aChildren = a.children ?? [];
  const bChildren = b.children ?? [];
  const pairs = alignChildrenByFingerprint(aChildren, bChildren, pageBaseUrl);
  const unmatchedClientMeaningful = pairs.unmatchedClient.filter((bi) => {
    const child = bChildren[bi]!;
    return !isClientShellScaffoldNode(child, `${path}>${child.tag}[${bi}]`);
  });
  if (pairs.unmatchedVirtual.length > 0 || unmatchedClientMeaningful.length > 0) {
    const clientComparable = bChildren.length - (pairs.unmatchedClient.length - unmatchedClientMeaningful.length);
    if (aChildren.length !== clientComparable) {
      record(path, 'child_count_mismatch', `virtual=${aChildren.length} client=${clientComparable}`);
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
    if (isClientShellScaffoldNode(child, `${path}>${child.tag}[${bi}]`)) continue;
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
 * Projected srcdoc / parser shell: Client-only leaf under `html>head` with no subtree.
 * Used only for **unmatched** client nodes after fingerprint alignment — never as a
 * pre-filter (that would drop real head metas that pair with Virtual).
 */
function isClientShellScaffoldNode(node: TreeNode, path: string): boolean {
  if (!isUnderHtmlHead(path)) return false;
  if (node.shadow !== undefined || node.nested !== undefined) return false;
  const children = node.children ?? [];
  if (children.length > 0) return false;
  if (node.text !== undefined && node.text.length > 0) return false;
  const attrs = node.attrs ?? [];
  if (attrs.length === 0 || attrs.length > 2) return false;
  return attrs.every(([, v]) => v.length <= 64);
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
  _path: string,
  pageBaseUrl: string,
): [string, string][] {
  const out: [string, string][] = [];
  for (const [name, value] of node.attrs ?? []) {
    const lower = name.toLowerCase();
    // Projected surface chrome (touch-action etc.) — not mirrored site style.
    if (lower === 'style' && (node.tag === 'html' || node.tag === 'body')) continue;
    if (URL_ATTR_NAMES.has(lower)) {
      out.push([lower, normalizeUrlAttrValue(value, pageBaseUrl)]);
      continue;
    }
    out.push([lower, value]);
  }
  out.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return out;
}

/**
 * Peel an already-rewritten virtual-asset URL (relative or absolute against any origin)
 * down to `/w7s/virtual-…` path form. Returns null when the URL is not a virtual path.
 */
export function peelVirtualAssetPath(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  for (const prefix of VIRTUAL_PATH_PREFIXES) {
    if (t.startsWith(prefix)) return t.split('?')[0]!;
  }
  if (!/^https?:\/\//i.test(t)) return null;
  try {
    const u = new URL(t);
    for (const prefix of VIRTUAL_PATH_PREFIXES) {
      if (u.pathname.startsWith(prefix)) return u.pathname;
    }
  } catch {
    /* keep null */
  }
  return null;
}

/** Canonical virtual-asset path (no session/cache-bust query) for structural URL compare. */
export function normalizeUrlAttrValue(raw: string, pageBaseUrl: string): string {
  const t = raw.trim();
  if (!t) return t;
  const stripped = stripReservedQueryParams(t);
  const peeled = peelVirtualAssetPath(stripped);
  if (peeled) return peeled;

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
      try {
        return !RESERVED_QUERY_PARAMS.has(decodeURIComponent(name));
      } catch {
        return !RESERVED_QUERY_PARAMS.has(name);
      }
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
