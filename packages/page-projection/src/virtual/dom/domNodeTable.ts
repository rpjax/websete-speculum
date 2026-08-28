/**
 * Bidirectional lookup table of DOM nodes (E-05 / parent §5.1).
 * Producer-side: holds live Node references from the Virtual document.
 */

import {
  NONE_DOM_NODE_KEY,
  type DomNodeKey,
} from '../../core/domNodeKey';

export { NONE_DOM_NODE_KEY, type DomNodeKey };

export class DomNodeTable {
  private byNode = new WeakMap<Node, DomNodeKey>();
  private readonly byKey = new Map<DomNodeKey, WeakRef<Node>>();
  private readonly finalizers: FinalizationRegistry<DomNodeKey>;
  /** §1.2: 0 = none, 1 = Document (via {@link bind}), 2… minted monotonically. */
  private nextKey: DomNodeKey = 2;
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

  /**
   * Bootstrap-only initialization (Stage 3, frame-protocol-production-completeness): a hard
   * navigation re-injects this whole script into a fresh JS realm, so the *identity map* is
   * already empty by construction — there is nothing to clear here, unlike `bumpGeneration()`.
   * This exists purely so a fresh instance reports the `generation` the orchestrator
   * (`PageProjectionBrowserSession`) already knows this navigation is (via `ProjectionConfig.generation`),
   * so a `rebuildAndResync` frame — and every ordinary tick after it — carries the right number for
   * `bootstrap.ts` to decide whether to prepend `EPOCH_RESET`.
   */
  setGeneration(generation: number): void {
    this.currentGeneration = generation;
  }

  get size(): number {
    return this.byKey.size;
  }

  allocate(node: Node): DomNodeKey {
    const existing = this.byNode.get(node);
    if (existing !== undefined) return existing;

    const key = this.mint();
    this.byNode.set(node, key);
    this.byKey.set(key, new WeakRef(node));
    this.finalizers.register(node, key, node);
    return key;
  }

  /**
   * Forces a specific id (frame-protocol.md §1.2 — id `1` is reserved for `Document`, not
   * allocated like an ordinary node). Idempotent. Advances `nextKey` past `key` so ordinary
   * `allocate()` calls never collide with it.
   */
  bind(node: Node, key: DomNodeKey): void {
    if (this.byNode.has(node)) return;
    this.byNode.set(node, key);
    this.byKey.set(key, new WeakRef(node));
    this.finalizers.register(node, key, node);
    if (key >= this.nextKey) this.nextKey = key + 1;
  }

  /**
   * Next session id (DOM or CSSOM). Never returns 0 or 1.
   * CSSOM WeakMaps call this so Sheet/Rule ids share the DOM counter (§1.1).
   */
  mint(): DomNodeKey {
    if (this.nextKey > 0xffffffff) throw new Error('DomNodeTable: id space exhausted');
    const key = this.nextKey;
    this.nextKey += 1;
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

  /**
   * frame-protocol.md §5.8 rebuild identity (`rebuildAndResync`) — clears the map so it can be
   * rebuilt from a live walk. Unlike `bumpGeneration()`, this does NOT advance `generation`:
   * `resync` is a same-generation wholesale replace, not `EPOCH_RESET`. `nextKey` is left
   * untouched, so freshly (re)allocated ids never collide with ids issued before the reset.
   */
  resetIdentity(): void {
    this.byNode = new WeakMap<Node, DomNodeKey>();
    this.byKey.clear();
  }

  /** Live `[id, node]` pairs, skipping any key whose `WeakRef` has already been collected. */
  *liveEntries(): IterableIterator<[DomNodeKey, Node]> {
    for (const [key, ref] of this.byKey) {
      const node = ref.deref();
      if (node !== undefined) yield [key, node];
    }
  }
}
