/**
 * MutationObserver: mark Active dirty sets only — no serialize/encode/send.
 */

import type { DomMutationAccumulator } from './domMutationAccumulator';
import { NONE_DOM_NODE_KEY, type DomNodeTable } from './domNodeTable';

export type DomMutationObserverOptions = {
  domNodes: DomNodeTable;
  accumulator: DomMutationAccumulator;
  root?: Node;
  isPublishable?: (node: Node) => boolean;
};

const OBSERVE_OPTIONS: MutationObserverInit = {
  subtree: true,
  childList: true,
  attributes: true,
  characterData: true,
};

export class DomMutationObserver {
  private readonly domNodes: DomNodeTable;
  private readonly accumulator: DomMutationAccumulator;
  private readonly root: Node;
  private readonly isPublishable: (node: Node) => boolean;
  private observer: MutationObserver | null = null;

  constructor(opts: DomMutationObserverOptions) {
    this.domNodes = opts.domNodes;
    this.accumulator = opts.accumulator;
    this.root = opts.root ?? document;
    this.isPublishable = opts.isPublishable ?? (() => true);
  }

  start(): void {
    this.stop();
    this.observer = new MutationObserver((records) => this.onRecords(records));
    this.observer.observe(this.root, OBSERVE_OPTIONS);
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  ingestForTest(records: MutationRecord[]): void {
    this.onRecords(records);
  }

  private onRecords(records: MutationRecord[]): void {
    for (let i = 0; i < records.length; i++) {
      this.markRecord(records[i]!);
    }
  }

  private markRecord(record: MutationRecord): void {
    const target = record.target;
    if (!this.isPublishable(target)) return;

    if (record.type === 'childList') {
      this.markChildList(record);
      return;
    }

    const key = this.domNodes.keyOf(target);
    if (key === NONE_DOM_NODE_KEY) return;

    if (record.type === 'attributes') this.accumulator.markAttr(key);
    else if (record.type === 'characterData') this.accumulator.markText(key);
  }

  private markChildList(record: MutationRecord): void {
    const parent = record.target;
    let parentKey = this.domNodes.keyOf(parent);
    if (parentKey === NONE_DOM_NODE_KEY) {
      if (!this.isPublishable(parent)) return;
      parentKey = this.domNodes.allocate(parent);
      this.accumulator.markNew(parentKey);
    }
    this.accumulator.markDirtyParent(parentKey);

    const added = record.addedNodes;
    for (let i = 0; i < added.length; i++) {
      const node = added[i]!;
      if (!this.isPublishable(node)) continue;
      const key = this.domNodes.allocate(node);
      this.accumulator.markNew(key);
    }

    const removed = record.removedNodes;
    for (let i = 0; i < removed.length; i++) {
      const node = removed[i]!;
      const key = this.domNodes.keyOf(node);
      if (key === NONE_DOM_NODE_KEY) continue;
      this.accumulator.markDetached(key);
    }
  }
}
