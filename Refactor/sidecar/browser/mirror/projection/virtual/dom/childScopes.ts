/**
 * Per-instance child-scope indexer. Not hashed into CHECK. Drop with the host row.
 */

import { isNestedBrowsingHost } from './nestedHost';

export type ChildScopeAdmit =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'host'; contextId: number };

export class ChildScopeIndex {
  private readonly map = new Map<number, number>();

  constructor(private readonly mint: () => number | null) {}

  get mapView(): ReadonlyMap<number, number> {
    return this.map;
  }

  get(nodeId: number): number | undefined {
    return this.map.get(nodeId);
  }

  drop(nodeId: number): void {
    this.map.delete(nodeId);
  }

  admit(nodeId: number, node: Node): ChildScopeAdmit {
    if (!isNestedBrowsingHost(node)) return { kind: 'none' };
    const existing = this.map.get(nodeId);
    if (existing !== undefined) return { kind: 'host', contextId: existing };
    const minted = this.mint();
    if (minted == null) return { kind: 'pending' };
    this.map.set(nodeId, minted);
    return { kind: 'host', contextId: minted };
  }

  lookupByContentWindow(
    source: unknown,
    nodeOf: (id: number) => Node | undefined,
  ): number | undefined {
    for (const [nodeId, contextId] of this.map) {
      const node = nodeOf(nodeId);
      if (node && (node as Node & { contentWindow?: unknown }).contentWindow === source) {
        return contextId;
      }
    }
    return undefined;
  }
}

export function createMintPort(opts: {
  mintSync?: () => number;
  requestMint?: () => Promise<number | undefined>;
}): () => number | null {
  if (opts.mintSync) return () => opts.mintSync!();
  const cache: number[] = [];
  let inflight = false;
  const kick = (): void => {
    if (inflight || !opts.requestMint) return;
    inflight = true;
    void opts.requestMint().then((c) => {
      inflight = false;
      if (typeof c === 'number' && c >= 2) cache.push(c);
    });
  };
  return () => {
    if (cache.length > 0) return cache.shift()!;
    kick();
    return null;
  };
}
