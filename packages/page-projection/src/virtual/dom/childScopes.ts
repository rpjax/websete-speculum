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

/**
 * Lifecycle edges the carrier needs. Admission is the moment a queued `initContext` becomes
 * answerable; a drop is the moment a child's port must die (runtime-redesign.md §8).
 */
export type ChildScopeHooks = {
  onAdmit?: (contextId: number, nodeId: number) => void;
  onDrop?: (contextId: number, nodeId: number) => void;
};

export class ChildScopeIndex {
  /** nodeId → contextId */
  private readonly map = new Map<number, number>();
  /** contextId → nodeId */
  private readonly byContext = new Map<number, number>();
  /** contentWindow → contextId (O(1) getScopeId) */
  private readonly byWindow = new WeakMap<object, number>();

  constructor(
    private readonly mint: () => number | null,
    private readonly hooks: ChildScopeHooks = {},
  ) {}

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
    if (!node) return null;
    const w = node.contentWindow;
    if (!w) return null;
    this.bindWindow(node, contextId);
    return w;
  }

  forEachLiveWindow(
    nodeOf: (id: number) => Node | undefined,
    fn: (w: Window, contextId: number) => void,
  ): void {
    for (const [contextId, nodeId] of this.byContext) {
      const node = nodeOf(nodeId) as HostWithWindow | undefined;
      if (!node) continue;
      const w = node.contentWindow;
      if (!w) continue;
      this.bindWindow(node, contextId);
      fn(w, contextId);
    }
  }

  drop(nodeId: number): void {
    const contextId = this.map.get(nodeId);
    if (contextId === undefined) return;
    this.map.delete(nodeId);
    this.byContext.delete(contextId);
    // WeakMap entry drops when the Window is GC'd; cannot delete by contextId alone.
    // Re-admit / windowOf / forEachLive rebind the live contentWindow key.
    this.hooks.onDrop?.(contextId, nodeId);
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
    this.hooks.onAdmit?.(minted, nodeId);
    return { kind: 'host', contextId: minted };
  }

  lookupByContentWindow(
    source: unknown,
    nodeOf: (id: number) => Node | undefined,
  ): number | undefined {
    if (source === null || typeof source !== 'object') return undefined;
    const hit = this.byWindow.get(source);
    if (hit !== undefined) {
      const nodeId = this.byContext.get(hit);
      if (nodeId !== undefined) {
        const node = nodeOf(nodeId) as HostWithWindow | undefined;
        // Reject stale WeakMap keys after contentWindow replace (iframe nav).
        if (node?.contentWindow === source) return hit;
      }
    }
    // Fallback: linear scan + rebind WeakMap (window object replaced after nav).
    for (const [contextId, nodeId] of this.byContext) {
      const node = nodeOf(nodeId) as HostWithWindow | undefined;
      if (node && node.contentWindow === source) {
        this.byWindow.set(source, contextId);
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

/**
 * Mint port — **exactly one id per RPC** (runtime-redesign.md §0 #4 / §6). Block allocation is
 * rejected: an id the parent never issued is not an address. The port answers `null` while its
 * single RPC is in flight, and the algorithm's job is then to *wait* — see
 * `TableFrameBuilder`'s frame hold — not to emit a frame with a hole where the host should be.
 *
 * `whenSettled()` is the re-drive edge for a caller that must rebuild rather than tick (cold
 * resync): it resolves when the in-flight RPC answers *or* fails, so the caller retries instead
 * of polling. `onMinted` is the same edge for the tick-driven path.
 */
export type MintPort = {
  (): number | null;
  /** Resolves when the in-flight RPC answers *or* fails — the retry edge for a rebuild caller. */
  whenSettled(): Promise<void>;
  /** Re-drive edge for the tick-driven caller: fires once per settled RPC. */
  onSettled(cb: () => void): void;
};

export function createMintPort(opts: {
  mintSync?: () => number;
  requestMint?: () => Promise<number | undefined>;
}): MintPort {
  const listeners: (() => void)[] = [];
  const settled = (): void => {
    for (let i = 0; i < listeners.length; i++) listeners[i]!();
  };

  if (opts.mintSync) {
    // Root: the allocator is in this realm, so nothing is ever pending and nothing is ever held.
    const sync = (): number | null => opts.mintSync!();
    return Object.assign(sync, {
      whenSettled: (): Promise<void> => Promise.resolve(),
      onSettled: (): void => {},
    });
  }

  let granted: number | null = null;
  let inflight: Promise<void> | null = null;

  const request = (): Promise<void> => {
    if (inflight !== null) return inflight;
    if (!opts.requestMint) return Promise.resolve();
    const pending = opts
      .requestMint()
      .then((id) => {
        if (typeof id === 'number' && id >= 2) granted = id;
      })
      .catch(() => {
        /* an unanswered mint leaves the frame held — waiting is the protocol */
      })
      .then(() => {
        inflight = null;
        settled();
      });
    inflight = pending;
    return pending;
  };

  const take = (): number | null => {
    if (granted !== null) {
      const id = granted;
      granted = null;
      return id;
    }
    void request();
    return null;
  };

  return Object.assign(take, {
    whenSettled: (): Promise<void> => (granted !== null ? Promise.resolve() : request()),
    onSettled: (cb: () => void): void => {
      listeners.push(cb);
    },
  });
}
