/**
 * Per-instance child-scope indexer. Not hashed into CHECK. Drop with the host row.
 * Forward nodeId→contextId + reverse contextId→nodeId + WeakMap contentWindow→contextId (O(1)).
 */

import { isNestedBrowsingHost } from './nestedHost';

export type ChildScopeAdmit =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'host'; contextId: number };

type HostWithWindow = Node & { contentWindow?: Window | null };

export class ChildScopeIndex {
  /** nodeId → contextId */
  private readonly map = new Map<number, number>();
  /** contextId → nodeId */
  private readonly byContext = new Map<number, number>();
  /** contentWindow → contextId (O(1) getScopeId) */
  private readonly byWindow = new WeakMap<object, number>();

  constructor(private readonly mint: () => number | null) {}

  get mapView(): ReadonlyMap<number, number> {
    return this.map;
  }

  get(nodeId: number): number | undefined {
    return this.map.get(nodeId);
  }

  hasContext(contextId: number): boolean {
    return this.byContext.has(contextId);
  }

  nodeIdOf(contextId: number): number | undefined {
    return this.byContext.get(contextId);
  }

  windowOf(
    contextId: number,
    nodeOf: (id: number) => Node | undefined,
  ): Window | null {
    const nodeId = this.byContext.get(contextId);
    if (nodeId === undefined) return null;
    const node = nodeOf(nodeId) as HostWithWindow | undefined;
    const w = node?.contentWindow;
    return w ?? null;
  }

  forEachLiveWindow(
    nodeOf: (id: number) => Node | undefined,
    fn: (w: Window, contextId: number) => void,
  ): void {
    for (const [contextId, nodeId] of this.byContext) {
      const node = nodeOf(nodeId) as HostWithWindow | undefined;
      const w = node?.contentWindow;
      if (w) fn(w, contextId);
    }
  }

  drop(nodeId: number): void {
    const contextId = this.map.get(nodeId);
    if (contextId === undefined) return;
    this.map.delete(nodeId);
    this.byContext.delete(contextId);
    // WeakMap entry drops when the Window is GC'd; cannot delete by contextId alone.
    // Re-admit of a new window for a recycled host node gets a new WeakMap key.
  }

  admit(nodeId: number, node: Node): ChildScopeAdmit {
    if (!isNestedBrowsingHost(node)) return { kind: 'none' };
    const existing = this.map.get(nodeId);
    if (existing !== undefined) {
      this.bindWindow(node as HostWithWindow, existing);
      return { kind: 'host', contextId: existing };
    }
    const minted = this.mint();
    if (minted == null) return { kind: 'pending' };
    this.map.set(nodeId, minted);
    this.byContext.set(minted, nodeId);
    this.bindWindow(node as HostWithWindow, minted);
    return { kind: 'host', contextId: minted };
  }

  lookupByContentWindow(
    source: unknown,
    nodeOf: (id: number) => Node | undefined,
  ): number | undefined {
    if (source !== null && typeof source === 'object') {
      const hit = this.byWindow.get(source);
      if (hit !== undefined) {
        // Still live in reverse index?
        if (this.byContext.has(hit)) return hit;
      }
    }
    // Fallback: linear scan + rebind WeakMap (window object replaced after nav).
    for (const [nodeId, contextId] of this.map) {
      const node = nodeOf(nodeId) as HostWithWindow | undefined;
      if (node && node.contentWindow === source) {
        if (source !== null && typeof source === 'object') {
          this.byWindow.set(source, contextId);
        }
        return contextId;
      }
    }
    return undefined;
  }

  private bindWindow(node: HostWithWindow, contextId: number): void {
    const w = node.contentWindow;
    if (w) this.byWindow.set(w, contextId);
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
