import type { ChildRef, FrameOp } from '../frame';
import type { FNode } from '../fmap';

/**
 * §5.7.3 — the Node-side flat decoded mirror. Kept up to date by applying
 * every relayed frame; it is the resync source (§5.7.2), the O2 comparison
 * source, and MUST hold E7 (flat form, not a JS object tree per node).
 */

export type MirrorNodeKind = 'element' | 'text' | 'comment';

export type MirrorNode = {
  kind: MirrorNodeKind;
  /** Element tag name, or `#text` / `#comment` for the other kinds. */
  tag: string;
  attrs: Record<string, string>;
  childIds: number[];
  value?: string;
};

/** §5.7.1 — every desync trigger the mirror can detect throws this; the caller MUST treat it as desync. */
export class MirrorDesyncError extends Error {}

const VOID_TAGS: ReadonlySet<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export class NodeMirror {
  private readonly nodes = new Map<number, MirrorNode>();
  private rootId: number | null = null;

  get size(): number {
    return this.nodes.size;
  }

  get root(): number | null {
    return this.rootId;
  }

  get(id: number): MirrorNode | undefined {
    return this.nodes.get(id);
  }

  setRoot(id: number): void {
    this.rootId = id;
  }

  /**
   * Bulk-loads a full F snapshot directly (e.g. from the establish stream's
   * initial walk), without requiring a pre-existing parent the way a live
   * `childList` frame does. Sets the mirror root to `node.id`.
   */
  seedRoot(node: FNode): void {
    this.registerSnapshot(node);
    this.rootId = node.id;
  }

  clear(): void {
    this.nodes.clear();
    this.rootId = null;
  }

  /**
   * §5.9.1 — applies one already-assembled frame as a single transaction.
   * Any address miss (an `existing` id absent from the mirror, or a `patch`/
   * `childList` targeting an unknown node) throws `MirrorDesyncError` (§5.7.1)
   * — this MUST never be caught and silently ignored by the caller.
   */
  applyFrame(ops: readonly FrameOp[]): void {
    for (const op of ops) {
      if (op.op === 'childList') this.applyChildList(op.parent, op.mode, op.children);
      else if (op.op === 'patch') this.applyPatch(op.node, op.snapshot);
      // scrollViewport / scrollElement carry no tree-shape effect on the mirror.
    }
  }

  private applyChildList(parentId: number, mode: 'full' | 'append', children: readonly ChildRef[]): void {
    const parent = this.nodes.get(parentId);
    if (!parent) throw new MirrorDesyncError(`childList: parent ${parentId} not found`);

    const resolvedIds: number[] = [];
    for (const ref of children) {
      if (ref.kind === 'existing') {
        if (!this.nodes.has(ref.id)) throw new MirrorDesyncError(`childList: existing id ${ref.id} not found`);
        resolvedIds.push(ref.id);
      } else {
        this.registerSnapshot(ref.node);
        resolvedIds.push(ref.node.id);
      }
    }

    if (mode === 'full') {
      const removedIds = parent.childIds.filter((id) => !resolvedIds.includes(id));
      for (const id of removedIds) this.unregisterSubtree(id);
      parent.childIds = resolvedIds;
    } else {
      parent.childIds = parent.childIds.concat(resolvedIds);
    }
  }

  private applyPatch(id: number, snapshot: FNode): void {
    const existing = this.nodes.get(id);
    if (!existing) throw new MirrorDesyncError(`patch: id ${id} not found`);
    if (snapshot.kind === 'element') {
      existing.tag = snapshot.tag;
      existing.attrs = { ...snapshot.attrs };
    } else {
      existing.value = snapshot.value;
    }
  }

  private registerSnapshot(node: FNode): void {
    if (node.kind === 'element') {
      const childIds = node.children.map((c) => c.id);
      this.nodes.set(node.id, { kind: 'element', tag: node.tag, attrs: { ...node.attrs }, childIds });
      for (const child of node.children) this.registerSnapshot(child);
    } else {
      this.nodes.set(node.id, {
        kind: node.kind,
        tag: node.kind === 'text' ? '#text' : '#comment',
        attrs: {},
        childIds: [],
        value: node.value,
      });
    }
  }

  private unregisterSubtree(id: number): void {
    const node = this.nodes.get(id);
    if (!node) return;
    for (const childId of node.childIds) this.unregisterSubtree(childId);
    this.nodes.delete(id);
  }

  /** §5.7.2.3 — resync source: serialize the mirror to well-formed HTML, ids riding as `speculum-anchor`. */
  serializeToHtml(rootId: number | null = this.rootId): string {
    if (rootId === null) return '';
    const node = this.nodes.get(rootId);
    if (!node) return '';
    return this.serializeNode(node, rootId);
  }

  /**
   * §5.7.2 — preorder tag stream read directly off the already-materialized mirror
   * (never a fresh page walk), for the OOB resync `establishEnd.nodeCount`/`.checksum`
   * — the same shape `collectTagsPreorder` derives from a live `FNode` walk in
   * `runEstablish`, so both paths feed `computeEstablishChecksum` identically.
   */
  collectTagsPreorder(rootId: number | null = this.rootId, out: string[] = []): string[] {
    if (rootId === null) return out;
    const node = this.nodes.get(rootId);
    if (!node) return out;
    // Element-only — must match liveAttach.collectTagsPreorder / client registry.
    if (node.kind === 'element') {
      out.push(node.tag);
      for (const childId of node.childIds) this.collectTagsPreorder(childId, out);
    }
    return out;
  }

  private serializeNode(node: MirrorNode, id: number): string {
    if (node.kind === 'text') return escapeHtmlText(node.value ?? '');
    if (node.kind === 'comment') return `<!--${node.value ?? ''}-->`;
    const attrPairs = Object.entries(node.attrs)
      .map(([name, value]) => ` ${name}="${escapeHtmlAttr(value)}"`)
      .join('');
    const anchorAttr = ` speculum-anchor="${id}"`;
    if (VOID_TAGS.has(node.tag)) return `<${node.tag}${anchorAttr}${attrPairs}>`;
    const inner = node.childIds
      .map((childId) => {
        const child = this.nodes.get(childId);
        return child ? this.serializeNode(child, childId) : '';
      })
      .join('');
    return `<${node.tag}${anchorAttr}${attrPairs}>${inner}</${node.tag}>`;
  }

  /** Approximate UTF-8 payload size of the flat mirror (E7 budget accounting). */
  estimateBytes(): number {
    let bytes = 0;
    for (const [id, node] of this.nodes) {
      bytes += 8; // id + kind overhead
      bytes += node.tag.length * 2;
      if (node.value) bytes += node.value.length * 2;
      for (const [k, v] of Object.entries(node.attrs)) bytes += (k.length + v.length) * 2;
      bytes += node.childIds.length * 4;
      void id;
    }
    return bytes;
  }

  /**
   * Trim detached/leaf-heavy subtrees until under `maxBytes`. Returns removed node count.
   * Prefer dropping comment leaves, then empty text, then deepest element leaves — never silent.
   */
  trimToBudget(maxBytes: number): number {
    let removed = 0;
    const pass = (predicate: (n: MirrorNode) => boolean): void => {
      if (this.estimateBytes() <= maxBytes) return;
      for (const [id, node] of [...this.nodes.entries()]) {
        if (id === this.rootId) continue;
        if (!predicate(node)) continue;
        // Only drop leaves (no children) that are not referenced as sole content of a required shell.
        if (node.childIds.length > 0) continue;
        let referenced = false;
        for (const parent of this.nodes.values()) {
          if (parent.childIds.includes(id)) {
            parent.childIds = parent.childIds.filter((c) => c !== id);
            referenced = true;
            break;
          }
        }
        if (referenced || !this.nodes.has(id)) {
          this.nodes.delete(id);
          removed += 1;
        }
        if (this.estimateBytes() <= maxBytes) return;
      }
    };
    pass((n) => n.kind === 'comment');
    pass((n) => n.kind === 'text' && !(n.value && n.value.trim()));
    pass((n) => n.kind === 'text');
    pass((n) => n.kind === 'element' && n.childIds.length === 0);
    return removed;
  }
}
