/**
 * Client identity registry — docs/page-projection-engine-redesign.md §5.1, §5.9.1.
 *
 * The address space is a bare `uint32`; there is no `childAt` / F-visible index
 * form on the wire (T7/G-A deleted). Resolution is therefore O(1): `Map<u32, Node>`
 * plus a reverse `WeakMap<Node, u32>` so a removed subtree can be unregistered in
 * O(subtree size) without a document-wide scan (§5.9.1: "a leaked registry entry
 * is a memory leak and a latent wrong-target bug").
 */
export class PageProjectionRegistry {
  private readonly nodesById = new Map<number, Node>()
  private readonly idsByNode = new WeakMap<Node, number>()

  /** Registers (or re-registers) one node under `id`. O(1). */
  register(id: number, node: Node): void {
    if (id <= 0) return
    const existing = this.nodesById.get(id)
    if (existing && existing !== node) this.idsByNode.delete(existing)
    this.nodesById.set(id, node)
    this.idsByNode.set(node, id)
  }

  /** Resolves an id to its live node, or `undefined` on a miss (§5.7.1 desync trigger). */
  get(id: number): Node | undefined {
    return this.nodesById.get(id)
  }

  /** Reverse lookup — input intents address by id via this map (§5.11.1). */
  idOf(node: Node): number | undefined {
    return this.idsByNode.get(node)
  }

  /** Nearest registered id walking up from `node` (element ancestors only). */
  idOfNearest(node: Node | null): number | undefined {
    let cur: Node | null = node
    while (cur) {
      const id = this.idsByNode.get(cur)
      if (id != null) return id
      cur = cur.parentNode
    }
    return undefined
  }

  /** Removes exactly one id, without touching its node's descendants. */
  unregister(id: number): void {
    const node = this.nodesById.get(id)
    if (!node) return
    this.nodesById.delete(id)
    this.idsByNode.delete(node)
  }

  /**
   * Unregisters `root` and every descendant carrying a registered id (§5.9.1:
   * "unregister on removal including all descendants"). Cost is proportional to
   * the removed subtree, never the whole registry.
   */
  unregisterSubtree(root: Node): void {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      const id = this.idsByNode.get(node)
      if (id != null) {
        this.nodesById.delete(id)
        this.idsByNode.delete(node)
      }
      for (const child of Array.from(node.childNodes)) stack.push(child)
    }
  }

  /** Total registered ids — soak-test bound check (`PP-ID-4`). */
  get size(): number {
    return this.nodesById.size
  }

  /** Drops every entry (double-buffer epoch boundary, §5.8.5). */
  clear(): void {
    this.nodesById.clear()
    // idsByNode is a WeakMap — entries fall out with their nodes; nothing to iterate.
  }

  /**
   * Walks a parsed establish document exactly once, registering every element
   * carrying a `speculum-anchor` id (§5.1.7: identity rides as this attribute
   * only in establish HTML; live frames address by the numeric id directly).
   *
   * @returns `nodeCount` and a rolling checksum over ids in visit order, for
   * the `establishEnd.nodeCount` / `.checksum` verification (§5.6.4, §5.7.1).
   */
  buildFromDocument(root: ParentNode): { nodeCount: number; checksum: number } {
    let nodeCount = 0
    let checksum = FNV_OFFSET_BASIS
    const visit = (el: Element) => {
      const id = readAnchorId(el)
      if (id != null) {
        this.register(id, el)
        nodeCount += 1
        checksum = fnv1a32Step(checksum, id)
      }
    }
    if (root instanceof Element) visit(root)
    const walker = (root.ownerDocument ?? (root as unknown as Document)).createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) visit(node as Element)
    return { nodeCount, checksum }
  }
}

function readAnchorId(el: Element): number | null {
  const raw = el.getAttribute('speculum-anchor')
  if (!raw) return null
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

/** FNV-1a over the id's 4 bytes (little-endian) — provisional until the sidecar's establish.ts fixes the algorithm. */
function fnv1a32Step(hash: number, id: number): number {
  let h = hash
  for (let shift = 0; shift < 32; shift += 8) {
    h ^= (id >>> shift) & 0xff
    h = Math.imul(h, FNV_PRIME)
  }
  return h >>> 0
}
