/**
 * §5.1 — off-DOM identity space. One instance per session (K2): forward
 * `WeakMap<Node, uint32>`, reverse `Map<uint32, WeakRef<Node>>`, released via
 * `FinalizationRegistry` so the reverse map cannot retain detached nodes and
 * cannot grow without bound (PP-ID-4).
 *
 * MUST NOT write identity attributes into the Virtual DOM (§5.1.3) — this
 * module never touches the node it identifies, only its own maps.
 *
 * `TNode` is generic (not the DOM `Node` type) so this module compiles and
 * unit-tests without a `dom` lib: any real DOM node satisfies `object`.
 */

export type NodeId = number;

/** Reserved: "no identity". Never allocated. */
export const NONE_NODE_ID: NodeId = 0;

export class IdentitySpace<TNode extends object = object> {
  private forward = new WeakMap<TNode, NodeId>();
  private readonly reverse = new Map<NodeId, WeakRef<TNode>>();
  private readonly registry: FinalizationRegistry<NodeId>;
  private nextId: NodeId = 1;
  private currentGeneration = 1;

  constructor() {
    this.registry = new FinalizationRegistry((id) => {
      const ref = this.reverse.get(id);
      if (ref !== undefined && ref.deref() === undefined) this.reverse.delete(id);
    });
  }

  get generation(): number {
    return this.currentGeneration;
  }

  /** Size of the reverse map — soak-tested by PP-ID-4 to stay bounded. */
  get reverseSize(): number {
    return this.reverse.size;
  }

  /**
   * §5.1.5 — allocates the first time a node is published; idempotent for a
   * node already known. Ids are monotonic from 1 and never reused (§5.1.1).
   */
  allocate(node: TNode): NodeId {
    const existing = this.forward.get(node);
    if (existing !== undefined) return existing;
    const id = this.nextId;
    this.nextId += 1;
    this.forward.set(node, id);
    this.reverse.set(id, new WeakRef(node));
    this.registry.register(node, id, node);
    return id;
  }

  /** §5.1.5 — a node never published has no id. */
  idOf(node: TNode): NodeId {
    return this.forward.get(node) ?? NONE_NODE_ID;
  }

  has(node: TNode): boolean {
    return this.forward.has(node);
  }

  /** Reverse resolution for input (§5.11) and state sensors. `0` never resolves. */
  resolve(id: NodeId): TNode | undefined {
    if (id === NONE_NODE_ID) return undefined;
    const ref = this.reverse.get(id);
    if (ref === undefined) return undefined;
    const node = ref.deref();
    if (node === undefined) {
      this.reverse.delete(id);
      return undefined;
    }
    return node;
  }

  /** Drop a specific node's identity (e.g. after §5.3.3 pruning) without a full bump. */
  release(node: TNode): void {
    const id = this.forward.get(node);
    if (id === undefined) return;
    this.forward.delete(node);
    this.reverse.delete(id);
    this.registry.unregister(node);
  }

  /**
   * §5.1.1 / real Document swap (T3): drop every identity. A fresh forward
   * map is required because `WeakMap` has no `clear()`. Ids keep counting up
   * from `nextId` — the next generation never reuses an id from a prior one.
   */
  bumpGeneration(): number {
    this.forward = new WeakMap<TNode, NodeId>();
    this.reverse.clear();
    this.currentGeneration += 1;
    return this.currentGeneration;
  }
}
