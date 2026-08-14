/**
 * MutationObserver → MutationBuffer only. No allocation, no serialize, no marking here —
 * frame-protocol.md §5.2: "no processing in the callback itself" (E3). Installed via CDP
 * `addScriptToEvaluateOnNewDocument` (§5.1), so `observe(document, …)` sees the parser's
 * output from byte zero.
 */

import type { MutationBuffer } from './mutationBuffer';

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
  }

  /** Test hook: feed records without a live MutationObserver. */
  ingestForTest(records: MutationRecord[]): void {
    this.buffer.push(records);
  }
}
