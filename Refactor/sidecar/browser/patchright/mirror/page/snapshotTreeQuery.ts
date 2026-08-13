/**
 * Node-side snapshot cache — a full raw-tree walk per tick, read synchronously by `FrameTreeQuery`.
 */
import type { ChildRef, FrameTreeQuery } from './frame';
import {
  publishElementSnapshot,
  publishTextSnapshot,
  publishCommentSnapshot,
  type FNode,
  type StateAttrValues,
} from './fmap';
import { NONE_NODE_ID, type NodeId } from './identity';
import { NodeMirror } from './node/mirror';
import { UrlRewriter } from './node/rewrite';

export type LiveNode = { readonly id: NodeId };

export type RawElement = {
  kind: 'element';
  id: number;
  tag: string;
  attrs: [string, string][];
  children: RawNode[];
  /** §5.2.2 PP-F-3 — set by `inpageScript.ts` when this element hosts a (open, or post-install closed) shadow root. */
  shadowRoot?: boolean;
  shadowClosed?: boolean;
  /** Cross-origin iframe whose interior is merged by CDP pierce (PP-F-4). */
  xo?: boolean;
  /** §5.2.1 — node-state sensor snapshot, keyed by `StateAttrKey` (not the wire attr name; `fmap.ts` maps that). */
  state?: StateAttrValues;
};
export type RawText = { kind: 'text'; id: number; value: string };
export type RawComment = { kind: 'comment'; id: number; value: string };
export type RawNode = RawElement | RawText | RawComment;

type CacheEntry = { raw: RawNode; parentId: NodeId; order: number };

export class SnapshotTreeQuery implements FrameTreeQuery<LiveNode> {
  private byId = new Map<NodeId, CacheEntry>();

  constructor(
    private readonly mirrorBox: { mirror: NodeMirror | null },
    private readonly rewriterBox: { current: UrlRewriter },
  ) {}

  load(root: RawNode | null): void {
    const next = new Map<NodeId, CacheEntry>();
    if (root) {
      let order = 0;
      const walk = (node: RawNode, parentId: NodeId): void => {
        next.set(node.id, { raw: node, parentId, order: order++ });
        if (node.kind === 'element') {
          for (const child of node.children) walk(child, node.id);
        }
      };
      walk(root, NONE_NODE_ID);
    }
    this.byId = next;
  }

  isConnected(): boolean {
    return true; // anything reachable from this tick's walk is, by construction, connected.
  }

  resolve(id: NodeId): LiveNode | undefined {
    return this.byId.has(id) ? { id } : undefined;
  }

  isWithin(id: NodeId, ancestors: ReadonlySet<NodeId>): boolean {
    let cur: NodeId | undefined = id;
    while (cur !== undefined && cur !== NONE_NODE_ID) {
      if (ancestors.has(cur)) return true;
      cur = this.byId.get(cur)?.parentId;
    }
    return false;
  }

  childListSnapshot(parentId: NodeId): ChildRef[] | undefined {
    const entry = this.byId.get(parentId);
    if (!entry || entry.raw.kind !== 'element') return undefined;
    const mirror = this.mirrorBox.mirror;
    return entry.raw.children
      .filter((child) => this.byId.has(child.id))
      .map((child): ChildRef =>
        mirror?.get(child.id) !== undefined
          ? { kind: 'existing', id: child.id }
          : { kind: 'fresh', node: this.buildFullFNode(child) },
      );
  }

  fullSnapshot(id: NodeId): FNode | undefined {
    const entry = this.byId.get(id);
    if (!entry) return undefined;
    return this.buildShallowFNode(entry.raw);
  }

  compareDocumentOrder(a: NodeId, b: NodeId): number {
    return (this.byId.get(a)?.order ?? 0) - (this.byId.get(b)?.order ?? 0);
  }

  /** Full recursive F snapshot — used for `childList` fresh entries and the establish walk. */
  buildFullFNode(raw: RawNode): FNode {
    if (raw.kind !== 'element') return this.leafFNode(raw);
    return publishElementSnapshot({
      id: raw.id,
      rawTag: raw.tag,
      rawAttrs: this.rewriteAttrs(raw),
      children: raw.children.filter((c) => this.byId.has(c.id)).map((c) => this.buildFullFNode(c)),
      iframeHost: raw.tag.toLowerCase() === 'iframe',
      shadowRoot: raw.shadowRoot,
      shadowClosed: raw.shadowClosed,
      state: raw.state,
    });
  }

  private buildShallowFNode(raw: RawNode): FNode {
    if (raw.kind !== 'element') return this.leafFNode(raw);
    return publishElementSnapshot({
      id: raw.id,
      rawTag: raw.tag,
      rawAttrs: this.rewriteAttrs(raw),
      children: [], // §5.4.1 — patch snapshots never carry children.
      iframeHost: raw.tag.toLowerCase() === 'iframe',
      shadowRoot: raw.shadowRoot,
      shadowClosed: raw.shadowClosed,
      state: raw.state,
    });
  }

  private leafFNode(raw: RawText | RawComment): FNode {
    return raw.kind === 'text' ? publishTextSnapshot(raw.id, raw.value) : publishCommentSnapshot(raw.id, raw.value);
  }

  private rewriteAttrs(raw: RawElement): Array<readonly [string, string]> {
    const rewriter = this.rewriterBox.current;
    return raw.attrs.map(([name, value]) => [name, rewriter.rewriteAttrValue(name, value)] as const);
  }
}
