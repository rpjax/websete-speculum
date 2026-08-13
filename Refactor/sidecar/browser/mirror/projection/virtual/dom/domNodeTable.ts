/**
 * Bidirectional lookup table of DOM nodes (E-05 / parent §5.1).
 * Producer-side: holds live Node references from the Virtual document.
 */

import {
  NONE_DOM_NODE_KEY,
  type DomNodeKey,
} from '../../models/domNodeKey';

export { NONE_DOM_NODE_KEY, type DomNodeKey };

export class DomNodeTable {
  private byNode = new WeakMap<Node, DomNodeKey>();
  private readonly byKey = new Map<DomNodeKey, WeakRef<Node>>();
  private readonly finalizers: FinalizationRegistry<DomNodeKey>;
  private nextKey: DomNodeKey = 1;
  private currentGeneration = 1;

  constructor() {
    this.finalizers = new FinalizationRegistry((key) => {
      const ref = this.byKey.get(key);
      if (ref !== undefined && ref.deref() === undefined) {
        this.byKey.delete(key);
      }
    });
  }

  get generation(): number {
    return this.currentGeneration;
  }

  get size(): number {
    return this.byKey.size;
  }

  allocate(node: Node): DomNodeKey {
    const existing = this.byNode.get(node);
    if (existing !== undefined) return existing;

    const key = this.nextKey;
    this.nextKey += 1;
    this.byNode.set(node, key);
    this.byKey.set(key, new WeakRef(node));
    this.finalizers.register(node, key, node);
    return key;
  }

  keyOf(node: Node): DomNodeKey {
    return this.byNode.get(node) ?? NONE_DOM_NODE_KEY;
  }

  has(node: Node): boolean {
    return this.byNode.has(node);
  }

  get(key: DomNodeKey): Node | undefined {
    if (key === NONE_DOM_NODE_KEY) return undefined;
    const ref = this.byKey.get(key);
    if (ref === undefined) return undefined;
    const node = ref.deref();
    if (node === undefined) {
      this.byKey.delete(key);
      return undefined;
    }
    return node;
  }

  release(node: Node): void {
    const key = this.byNode.get(node);
    if (key === undefined) return;
    this.byNode.delete(node);
    this.byKey.delete(key);
    this.finalizers.unregister(node);
  }

  bumpGeneration(): number {
    this.byNode = new WeakMap<Node, DomNodeKey>();
    this.byKey.clear();
    this.currentGeneration += 1;
    return this.currentGeneration;
  }
}
