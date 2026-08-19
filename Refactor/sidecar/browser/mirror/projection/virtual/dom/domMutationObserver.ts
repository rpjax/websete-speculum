/**
 * MutationObserver → MutationBuffer only. No allocation, no serialize, no marking here —
 * frame-protocol.md §5.2: "no processing in the callback itself" (E3). Installed via CDP
 * `addScriptToEvaluateOnNewDocument` (§5.1), so `observe(document, …)` sees the parser's
 * output from byte zero.
 *
 * One observer on `document` plus one per admitted `ShadowRoot` — same buffer ([shadow.md](shadow.md)).
 */

import type { MutationBuffer } from './mutationBuffer';
import type { DomNodeTable } from './domNodeTable';

export type DomMutationObserverOptions = {
  buffer: MutationBuffer;
  root?: Node;
};

const OBSERVE_OPTIONS: MutationObserverInit = {
  subtree: true,
  childList: true,
  attributes: true,
  characterData: true,
};

export class DomMutationObserver {
  private readonly buffer: MutationBuffer;
  private readonly root: Node;
  private observer: MutationObserver | null = null;
  private readonly extra = new Map<Node, MutationObserver>();

  constructor(opts: DomMutationObserverOptions) {
    this.buffer = opts.buffer;
    this.root = opts.root ?? document;
  }

  start(): void {
    this.stop();
    this.observer = new MutationObserver((records) => this.buffer.push(records));
    this.observer.observe(this.root, OBSERVE_OPTIONS);
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.unobserveAllRoots();
  }

  observeRoot(root: Node): void {
    if (root === this.root || this.extra.has(root)) return;
    const observer = new MutationObserver((records) => this.buffer.push(records));
    observer.observe(root, OBSERVE_OPTIONS);
    this.extra.set(root, observer);
  }

  unobserveRoot(root: Node): void {
    const observer = this.extra.get(root);
    if (observer === undefined) return;
    observer.disconnect();
    this.extra.delete(root);
  }

  unobserveAllRoots(): void {
    for (const observer of this.extra.values()) observer.disconnect();
    this.extra.clear();
  }

  /** Observe every `ShadowRoot` currently in the identity map; drop observers whose root is gone. */
  syncObservedShadowRoots(domNodes: DomNodeTable): void {
    const live = new Set<Node>();
    for (const [, node] of domNodes.liveEntries()) {
      if (node instanceof ShadowRoot) {
        live.add(node);
        this.observeRoot(node);
      }
    }
    for (const root of this.extra.keys()) {
      if (!live.has(root)) this.unobserveRoot(root);
    }
  }

  /**
   * Pull records the browser has queued but not yet delivered to the callback (MO delivery is a
   * microtask). Must run immediately before every buffer drain / snapshot — otherwise the table
   * is built from stale delivered records while live DOM already includes those mutations.
   */
  takePendingIntoBuffer(): void {
    this.takeOne(this.observer);
    for (const observer of this.extra.values()) this.takeOne(observer);
  }

  /** Test hook: feed records without a live MutationObserver. */
  ingestForTest(records: MutationRecord[]): void {
    this.buffer.push(records);
  }

  private takeOne(observer: MutationObserver | null): void {
    if (observer === null) return;
    const pending = observer.takeRecords();
    if (pending.length > 0) this.buffer.push(pending);
  }
}
