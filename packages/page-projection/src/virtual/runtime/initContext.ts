/**
 * `initContext` — acquire `{ contextId, generation }` for **this install** of this document
 * (runtime-redesign.md §5 boot order, §6 identity).
 *
 * Not a "handshake": that word is reserved for the loopback LB hello and for the ContextBus port
 * setup. `initContext` is the **activation gate** — before it answers, a context observes and
 * buffers but never emits.
 *
 * ```
 * nested → upward peer is window.parent   (ContextBus over MessagePort)
 * root   → upward peer is the SERVICE WORKER (extension bridge)
 * ```
 *
 * Both sides answer the same shape, which is what lets `bootstrap` keep one path.
 *
 * Why `generation` cannot come from the frozen config bag: the sidecar injects one config per
 * *session* navigation, but a link click replaces the document without the sidecar bumping
 * anything — so a config-sourced generation is stale for exactly the case that needs it (§6).
 * Every document replacement, from any cause, must produce a new generation, and only an
 * authority that outlives the document can say so.
 */

import { CONTEXT_ID_ROOT } from '../../core/frame';

export type ContextIdentity = {
  contextId: number;
  generation: number;
};

/**
 * The root's upward authority (service worker, reached through the extension bridge). It owns the
 * socket, so it survives root navigation and can state which install this is.
 *
 * Installed on `globalThis` by the extension MAIN-world shim under {@link UPWARD_PEER_GLOBAL} —
 * same precedent as the plane bridge global. The package never fabricates one.
 */
export type RootUpwardPeer = {
  initContext(): Promise<{ generation: number }>;
};

export const UPWARD_PEER_GLOBAL = '__speculumProjectionUpward' as const;

/** Nested: no answer → **dormant**. An ad iframe that nobody admits is not an error (§5). */
export const NESTED_INIT_CONTEXT_TIMEOUT_MS = 2_000;
/** Root: no answer → fail closed (launch budget InitContext slice). */
export const ROOT_INIT_CONTEXT_TIMEOUT_MS = 20_000;

declare global {
  // eslint-disable-next-line no-var
  var __speculumProjectionUpward: RootUpwardPeer | undefined;
}

export function resolveRootUpwardPeer(
  scope: { __speculumProjectionUpward?: unknown } = globalThis,
): RootUpwardPeer | null {
  const candidate = scope.__speculumProjectionUpward;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const peer = candidate as Partial<RootUpwardPeer>;
  return typeof peer.initContext === 'function' ? (peer as RootUpwardPeer) : null;
}

/** Nested side of `initContext` — one RPC to the immediate parent, one deadline, no retry loop. */
export type NestedInitContextPort = {
  requestInitContext(timeoutMs: number): Promise<ContextIdentity | null>;
};

/** `null` = dormant. Never a fabricated id: "a timeout must never become an id" (§6). */
export async function initNestedContext(
  port: NestedInitContextPort,
  timeoutMs: number = NESTED_INIT_CONTEXT_TIMEOUT_MS,
): Promise<ContextIdentity | null> {
  return port.requestInitContext(timeoutMs);
}

/**
 * Root side. `contextId` is the constant `1` (no RPC — the root has no parent to name it), but
 * `generation` still has to be *stated* by the authority above, so this is one call, not a read.
 *
 * Throws on missing peer or on timeout: for the root, "no authority answered" is a broken
 * session, not a dormant frame.
 */
export async function initRootContext(
  peer: RootUpwardPeer | null,
  timeoutMs: number = ROOT_INIT_CONTEXT_TIMEOUT_MS,
): Promise<ContextIdentity> {
  if (peer === null) {
    throw new Error(
      `[speculumProjection] initContext: no upward peer for the root context — ` +
        `expected globalThis.${UPWARD_PEER_GLOBAL}.initContext() installed by the extension ` +
        `service-worker bridge. The root cannot invent its own generation.`,
    );
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `[speculumProjection] initContext: upward peer did not answer within ${timeoutMs}ms — session faulted`,
        ),
      );
    }, timeoutMs);
  });

  try {
    const answer = await Promise.race([peer.initContext(), deadline]);
    const generation = answer?.generation;
    if (typeof generation !== 'number' || !Number.isInteger(generation) || generation < 1) {
      throw new Error(
        `[speculumProjection] initContext: upward peer answered a bad generation (${String(generation)})`,
      );
    }
    return { contextId: CONTEXT_ID_ROOT, generation };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
