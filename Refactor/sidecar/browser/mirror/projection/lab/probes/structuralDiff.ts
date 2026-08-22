/**
 * Structural (topology-only) diff between a Virtual snapshot and a Client snapshot —
 * `TreeNode` shapes from `projected/domTreeSnapshot.ts` (Virtual tree via coherent
 * `flushProjectionSnapshot({ includeTree })` / `snapshotEvaluate`; Projected via client snapshot).
 * One "diff producer" (`kind: 'structural'`) — a future pixel/visual producer can sit next to
 * this one without touching it.
 */

import type { TreeNode } from '@speculum/page-projection/core/treeNode';

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

const MAX_DIVERGENCES = 50;

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

export function diffTrees(virtual: TreeNode, client: TreeNode): StructuralDiffResult {
  const divergences: Divergence[] = [];
  let count = 0;
  const record = (path: string, kind: DivergenceKind, details: string): void => {
    count += 1;
    if (divergences.length < MAX_DIVERGENCES) divergences.push({ path, kind, details });
  };
  walk(virtual, client, '#document', record);
  return { kind: 'structural', identical: count === 0, divergenceCount: count, divergences };
}

function walk(
  a: TreeNode | undefined,
  b: TreeNode | undefined,
  path: string,
  record: (path: string, kind: DivergenceKind, details: string) => void,
): void {
  if (a === undefined && b === undefined) return;
  if (a === undefined) {
    record(path, 'extra_node', `client has <${describe(b!)}>, virtual has none`);
    return;
  }
  if (b === undefined) {
    record(path, 'missing_node', `virtual has <${describe(a)}>, client has none`);
    return;
  }
  if (a.tag !== b.tag) {
    record(path, 'tag_mismatch', `virtual=${a.tag} client=${b.tag}`);
    return; // divergent enough that walking children further is just noise on top of this
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
  const attrDetails = diffAttrs(a.attrs ?? [], b.attrs ?? []);
  if (attrDetails !== null) record(path, 'attr_mismatch', attrDetails);

  const aChildren = a.children ?? [];
  const bChildren = b.children ?? [];
  if (aChildren.length !== bChildren.length) {
    record(path, 'child_count_mismatch', `virtual=${aChildren.length} client=${bChildren.length}`);
  }
  const max = Math.max(aChildren.length, bChildren.length);
  for (let i = 0; i < max; i++) {
    walk(aChildren[i], bChildren[i], `${path}>${a.tag}[${i}]`, record);
  }

  if (a.shadow !== undefined || b.shadow !== undefined) {
    walk(a.shadow, b.shadow, `${path}>${a.tag}::shadow`, record);
  }
  if (a.nested !== undefined || b.nested !== undefined) {
    walk(a.nested, b.nested, `${path}>${a.tag}::nested`, record);
  }
}

function diffAttrs(a: [string, string][], b: [string, string][]): string | null {
  const am = new Map(a);
  const bm = new Map(b);
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
