/**
 * Third equality of docs/gecko-engine/redesign/14-nodedescriptor.md §3:
 * d(PTR) == d(PN) — table row descriptor hash vs hash of the materialized node.
 *
 * d(PTR) = ReplicatedTable row.rowHash
 * d(PN)  = computeRowHash(id, kind, liveParent, livePrev, contentHashFromDom)
 */

import { DOCUMENT_ID } from './frame';
import { NodeKind } from './opcodes';
import {
  addMod64,
  computeRowHash,
  hashAttr,
  hashName,
  hashNs,
  hashShadowInit,
  hashValue,
} from './rowHash';
import type { ReplicatedTable } from './replicatedTable';
import { classifyElementNs } from './elementNs';
import { SHADOW_MODE_CLOSED, SHADOW_MODE_OPEN } from './frame';

export type DescriptorMismatch = {
  id: number;
  field: string;
  expected: bigint;
  actual: bigint;
};

export type DescriptorEqualityResult =
  | { ok: true; checked: number }
  | { ok: false; checked: number; mismatch: DescriptorMismatch };

export type MaterializedLookup = {
  get(id: number): Node | undefined;
  idOf(node: Node): number | undefined;
};

function isSkippedKind(kind: number): boolean {
  return kind === NodeKind.Sheet || kind === NodeKind.Rule;
}

function liveParentId(node: Node, lookup: MaterializedLookup): number {
  const p = node.parentNode;
  if (!p) {
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && (node as ShadowRoot).host) {
      return lookup.idOf((node as ShadowRoot).host) ?? 0;
    }
    return DOCUMENT_ID;
  }
  if (p.nodeType === Node.DOCUMENT_NODE) return DOCUMENT_ID;
  return lookup.idOf(p) ?? 0;
}

function livePrevSiblingId(node: Node, lookup: MaterializedLookup): number {
  let prev: Node | null = node.previousSibling;
  while (prev) {
    const id = lookup.idOf(prev);
    if (id !== undefined) return id;
    prev = prev.previousSibling;
  }
  return 0;
}

function contentHashFromDom(node: Node, kind: number): bigint {
  if (kind === NodeKind.Text || kind === NodeKind.Comment) {
    return hashValue(node.textContent ?? '');
  }
  if (kind === NodeKind.ShadowRoot) {
    const sr = node as ShadowRoot;
    const mode = sr.mode === 'open' ? SHADOW_MODE_OPEN : SHADOW_MODE_CLOSED;
    return hashShadowInit(mode, 0);
  }
  if (kind === NodeKind.Element && node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    const { ns, uri } = classifyElementNs(el.namespaceURI);
    let h = 0n;
    h = addMod64(h, hashNs(ns, uri));
    h = addMod64(h, hashName(el.localName));
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes.item(i)!;
      if (a.name.startsWith('data-speculum-')) continue;
      h = addMod64(h, hashAttr(a.name, a.value));
    }
    return h;
  }
  return 0n;
}

/**
 * Compare d(PTR) and d(PN) for every DOM-bearing table row that has a registry entry.
 * Detached rows (parent===0) without a live node are skipped.
 */
export function checkPtrEqualsPn(
  table: ReplicatedTable,
  lookup: MaterializedLookup,
): DescriptorEqualityResult {
  let checked = 0;
  let mismatch: DescriptorMismatch | undefined;

  table.forEachRow((id, row) => {
    if (mismatch || isSkippedKind(row.kind)) return;
    const node = lookup.get(id);
    if (!node) {
      if (row.parent === 0) return;
      mismatch = { id, field: 'materialized', expected: row.rowHash, actual: 0n };
      return;
    }

    const liveParent = liveParentId(node, lookup);
    const livePrev = livePrevSiblingId(node, lookup);
    const content = contentHashFromDom(node, row.kind);
    const pn = computeRowHash(id, row.kind, liveParent, livePrev, content);
    const ptr = row.rowHash;
    checked++;
    if (pn !== ptr) {
      let field = 'rowHash';
      if (liveParent !== row.parent) field = 'parent';
      else if (livePrev !== row.prevSibling) field = 'prevSibling';
      else if (content !== row.contentHash) field = 'contentHash';
      mismatch = { id, field, expected: ptr, actual: pn };
    }
  });

  if (mismatch) return { ok: false, checked, mismatch };
  return { ok: true, checked };
}
