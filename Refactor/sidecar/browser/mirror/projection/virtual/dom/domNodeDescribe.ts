/**
 * Shared node → wire-descriptor helpers — frame-protocol.md §4.2. Used by both the incremental
 * builder (`tableFrameBuilder.ts`, §5.5) and DOM resync describe (`domResync.ts`): both need
 * exactly the same "read a live node, produce its `NODE_NEW` descriptor" logic, just triggered
 * from a different traversal (mutation-driven DFS vs. identity-map iteration).
 */

import { classifyElementNs, ElementNs } from '../../models/elementNs';
import { NodeKind, OpCode } from '../../models/opcodes';
import { SHADOW_MODE_OPEN, type AttrPair, type FrameOp } from '../../models/frame';
import type { DomNodeKey } from '../../models/domNodeKey';
import { shadowInitFlags } from './shadowAdmit';

/** The kinds a live DOM node can produce (Sheet/Rule are CSSOM-only). */
export type DomNodeKind =
  | NodeKind.Element
  | NodeKind.Text
  | NodeKind.Comment
  | NodeKind.Doctype
  | NodeKind.ShadowRoot;

export function nodeKindOf(node: Node): DomNodeKind | null {
  if (node instanceof ShadowRoot) return NodeKind.ShadowRoot;
  switch (node.nodeType) {
    case Node.ELEMENT_NODE:
      return NodeKind.Element;
    case Node.TEXT_NODE:
      return NodeKind.Text;
    case Node.COMMENT_NODE:
      return NodeKind.Comment;
    case Node.DOCUMENT_TYPE_NODE:
      return NodeKind.Doctype;
    default:
      // Fragments never appear in addedNodes (browsers unwrap them); anything else
      // (CDATA, PI) is not part of the DOM-only v0 surface. ShadowRoot is handled above.
      return null;
  }
}

/**
 * Single `NamedNodeMap` iteration instead of `getAttributeNames()` + one `getAttribute()` call
 * per name — the latter is two native (V8 <-> Blink) round-trips per attribute where one
 * suffices; per the 2026-08-13 CPU profile this was ~16.5% of producer build time.
 */
export function readAttrs(el: Element): AttrPair[] {
  const attrs = el.attributes;
  const out: AttrPair[] = new Array(attrs.length);
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i]!;
    out[i] = { name: attr.name, value: attr.value };
  }
  return out;
}

/** `NODE_NEW` descriptor, read fresh from the live node — never from a producer-side cache. */
export function describeNodeNew(id: DomNodeKey, kind: DomNodeKind, node: Node, hostId?: DomNodeKey): FrameOp {
  if (kind === NodeKind.ShadowRoot) {
    const sr = node as ShadowRoot;
    return {
      op: OpCode.NodeNew,
      id,
      kind: NodeKind.ShadowRoot,
      host: hostId ?? 0,
      mode: SHADOW_MODE_OPEN,
      initFlags: shadowInitFlags(sr),
    };
  }
  if (kind === NodeKind.Element) {
    const el = node as Element;
    const classified = classifyElementNs(el.namespaceURI);
    return {
      op: OpCode.NodeNew,
      id,
      kind,
      ns: classified.ns,
      name: el.tagName.toLowerCase(),
      attrs: readAttrs(el),
      ...(classified.ns === ElementNs.Custom ? { uri: classified.uri } : {}),
    };
  }
  if (kind === NodeKind.Doctype) {
    return { op: OpCode.NodeNew, id, kind, name: (node as DocumentType).name || 'html' };
  }
  return { op: OpCode.NodeNew, id, kind, value: node.textContent ?? '' };
}
