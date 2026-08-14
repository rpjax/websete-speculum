/**
 * Client identity registry (frame-protocol.md §1.2, §6). Address space is a bare `u32`
 * mapping 1:1 to the producer's `DomNodeTable` ids. Resolution is O(1): `Map<u32, Node>`
 * plus a reverse `WeakMap<Node, u32>` so a removed subtree can be unregistered in
 * O(subtree size) without a document-wide scan.
 *
 * No anchor-attribute / establish-checksum machinery here — that was the Node-mirror
 * resync path (contracts/07-recovery.md), dead and superseded by frame-protocol.md §5.8.
 */
export class PageProjectionRegistry {
  private readonly nodesById = new Map<number, Node>();
  private readonly idsByNode = new WeakMap<Node, number>();

  /** Registers (or re-registers) one node under `id`. O(1). */
  register(id: number, node: Node): void {
    if (id <= 0) return;
    const existing = this.nodesById.get(id);
    if (existing && existing !== node) this.idsByNode.delete(existing);
    this.nodesById.set(id, node);
    this.idsByNode.set(node, id);
  }

  /** Resolves an id to its live node, or `undefined` on a miss (a desync trigger upstream). */
  get(id: number): Node | undefined {
    return this.nodesById.get(id);
  }

  /** Reverse lookup — input intents address by id via this map. */
  idOf(node: Node): number | undefined {
    return this.idsByNode.get(node);
  }

  /** Nearest registered id walking up from `node`. */
  idOfNearest(node: Node | null): number | undefined {
    let cur: Node | null = node;
    while (cur) {
      const id = this.idsByNode.get(cur);
      if (id != null) return id;
      cur = cur.parentNode;
    }
    return undefined;
  }

  /** Removes exactly one id, without touching its node's descendants. */
  unregister(id: number): void {
    const node = this.nodesById.get(id);
    if (!node) return;
    this.nodesById.delete(id);
    this.idsByNode.delete(node);
  }

  /** Unregisters `root` and every descendant carrying a registered id. */
  unregisterSubtree(root: Node): void {
    const stack: Node[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      const id = this.idsByNode.get(node);
      if (id != null) {
        this.nodesById.delete(id);
        this.idsByNode.delete(node);
      }
      for (const child of Array.from(node.childNodes)) stack.push(child);
    }
  }

  /** Total registered ids — perf/soak signal. */
  get size(): number {
    return this.nodesById.size;
  }

  /**
   * Drops every `id → node` entry — `EPOCH_RESET`'s `DOM` effect (§4.1, Stage 3 of
   * frame-protocol-production-completeness): `applyDom.ts`'s `applyEpochReset` calls this, then
   * immediately re-registers `DOCUMENT_ID`, before any `NODE_NEW`/`INSERT` in the same frame
   * repopulates the rest. Leaves the reverse `idsByNode` `WeakMap` alone — its entries key off
   * now-discarded nodes and fall out of scope for GC on their own; nothing reads a stale id back
   * out of it without first missing on `nodesById.get`, which this already empties.
   */
  clear(): void {
    this.nodesById.clear();
  }
}
