/**
 * ContextBus carrier — directed `MessagePort` transport (runtime-redesign.md §0 #1 / §8).
 *
 * Broadcast is **rejected**. The only `window.postMessage` in the whole bus is the two-message
 * port handshake below ("bus port setup" — not `initContext`, not the loopback hello):
 *
 *   1. child  → parent   `{ channel, kind: 'port-setup' }`
 *   2. parent → child    `{ channel, kind: 'port-setup-ack' }` + **transfer** `port2`
 *   3. everything after that (mint / getScopeId / initContext / control / frames) rides the port
 *   4. inner navigation: the parent **closes** the old port — a dead install cannot forward
 *
 * Why it matters beyond hygiene: `postMessage(envelope, '*')` publishes every bus message to
 * every site and ad listener in the MAIN world, and costs one postMessage per live child per
 * message. A port is point-to-point and unobservable from page script that never received it.
 */

import { CONTEXT_BUS_CHANNEL, isBusEnvelope, type BusEnvelope } from './types';

export const BUS_PORT_SETUP = 'port-setup' as const;
export const BUS_PORT_SETUP_ACK = 'port-setup-ack' as const;

export type BusPortSetupMessage = {
  channel: typeof CONTEXT_BUS_CHANNEL;
  kind: typeof BUS_PORT_SETUP;
};

export type BusPortSetupAckMessage = {
  channel: typeof CONTEXT_BUS_CHANNEL;
  kind: typeof BUS_PORT_SETUP_ACK;
};

/** Structural `window` — real `Window`, and the fakes package units build. */
export type MessageEventTarget = {
  addEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
};

export type WindowPostTarget = {
  postMessage(message: unknown, targetOrigin: string, transfer?: readonly Transferable[]): void;
};

/** Cap on envelopes buffered while the port handshake is still in flight. */
const MAX_QUEUED_BEFORE_PORT = 256;
/** The setup message is an unacknowledged datagram; re-send until the port arrives. */
const DEFAULT_SETUP_RETRY_MS = 100;

export function isBusPortSetup(data: unknown): data is BusPortSetupMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Partial<BusPortSetupMessage>;
  return msg.channel === CONTEXT_BUS_CHANNEL && msg.kind === BUS_PORT_SETUP;
}

export function isBusPortSetupAck(data: unknown): data is BusPortSetupAckMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Partial<BusPortSetupAckMessage>;
  return msg.channel === CONTEXT_BUS_CHANNEL && msg.kind === BUS_PORT_SETUP_ACK;
}

export type ChildPortHubOptions = {
  onInbound: (envelope: BusEnvelope, port: MessagePort, source: object) => void;
  /** A child window re-opened its channel — the previous install's port has just been closed. */
  onPortReplaced?: (source: object) => void;
};

/**
 * Parent side of the handshake: one port per child browsing context, keyed by the child's
 * `WindowProxy`. That key is stable across the child's inner navigations (which is exactly why
 * "same `contextId` across inner nav" works), so a second `port-setup` from the same key *is*
 * the inner-navigation signal — and the moment the old port must die.
 */
export class ChildPortHub {
  private readonly ports = new Map<object, MessagePort>();
  private readonly sourceOfContext = new Map<number, object>();
  private readonly options: ChildPortHubOptions;
  private disposed = false;

  constructor(options: ChildPortHubOptions) {
    this.options = options;
  }

  /**
   * Answer one `port-setup`. Any port already held for this child is closed first: the frames a
   * dead install might still push must have nowhere to land (§8 step 4, dead-install fence).
   */
  accept(source: object): MessagePort | null {
    if (this.disposed) return null;
    const target = source as WindowPostTarget;
    if (typeof target.postMessage !== 'function') return null;

    if (this.ports.has(source)) {
      this.closeForWindow(source);
      this.options.onPortReplaced?.(source);
    }

    const channel = new MessageChannel();
    const mine = channel.port1;
    mine.onmessage = (event: MessageEvent): void => {
      const data = event.data as unknown;
      if (!isBusEnvelope(data)) return;
      this.options.onInbound(data, mine, source);
    };
    mine.start?.();
    this.ports.set(source, mine);

    const ack: BusPortSetupAckMessage = {
      channel: CONTEXT_BUS_CHANNEL,
      kind: BUS_PORT_SETUP_ACK,
    };
    target.postMessage(ack, '*', [channel.port2]);
    return mine;
  }

  /** Remember which contextId this child turned out to be, so a host drop can close its port. */
  bindContext(contextId: number, source: object): void {
    this.sourceOfContext.set(contextId, source);
  }

  portForWindow(source: object | null | undefined): MessagePort | null {
    if (!source) return null;
    return this.ports.get(source) ?? null;
  }

  portForContext(contextId: number): MessagePort | null {
    const source = this.sourceOfContext.get(contextId);
    if (source === undefined) return null;
    return this.ports.get(source) ?? null;
  }

  closeForWindow(source: object): void {
    const port = this.ports.get(source);
    if (port === undefined) return;
    this.ports.delete(source);
    port.onmessage = null;
    port.close();
  }

  closeForContext(contextId: number): void {
    const source = this.sourceOfContext.get(contextId);
    this.sourceOfContext.delete(contextId);
    if (source !== undefined) this.closeForWindow(source);
  }

  forEachPort(fn: (port: MessagePort, source: object) => void): void {
    for (const [source, port] of this.ports) fn(port, source);
  }

  get size(): number {
    return this.ports.size;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const port of this.ports.values()) {
      port.onmessage = null;
      port.close();
    }
    this.ports.clear();
    this.sourceOfContext.clear();
  }
}

export type ParentPortLinkOptions = {
  window: MessageEventTarget;
  parent: WindowPostTarget;
  onInbound: (envelope: BusEnvelope) => void;
  setupRetryMs?: number;
};

/**
 * Child side of the handshake. `send` never fails for lack of a port: envelopes queue until the
 * ack arrives, because a context that boots at `document_start` legitimately wants to ask its
 * parent something before the channel finished opening (§5, "listeners before await, with
 * queuing" — a lost request is a permanently dormant context).
 */
export class ParentPortLink {
  private readonly win: MessageEventTarget;
  private readonly parent: WindowPostTarget;
  private readonly onInbound: (envelope: BusEnvelope) => void;
  private readonly setupRetryMs: number;
  private readonly onMessage: (event: MessageEvent) => void;
  private port: MessagePort | null = null;
  private queued: BusEnvelope[] = [];
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** True after postSetup until adopt/abandon — blocks duplicate setups that reset the parent port. */
  private setupInFlight = false;

  constructor(opts: ParentPortLinkOptions) {
    this.win = opts.window;
    this.parent = opts.parent;
    this.onInbound = opts.onInbound;
    this.setupRetryMs = opts.setupRetryMs ?? DEFAULT_SETUP_RETRY_MS;
    this.onMessage = (event: MessageEvent): void => {
      if (!isBusPortSetupAck(event.data)) return;
      const port = event.ports?.[0];
      if (!port) return;
      this.adopt(port);
    };
    this.win.addEventListener('message', this.onMessage);
  }

  get ready(): boolean {
    return this.port !== null;
  }

  /** Send the setup message. Idempotent while a port is already held. */
  open(): void {
    if (this.disposed || this.port !== null) return;
    // One in-flight setup at a time: a second post while the ack is still queued
    // makes the parent treat it as inner-nav (replace port + drop pending initContext).
    if (this.setupInFlight) return;
    this.postSetup();
    this.armRetry();
  }

  /**
   * bfcache restore (`pageshow` persisted) or a parent-side close: drop the old port and run the
   * handshake again before anything else is sent (runtime-redesign.md §0 #8 / M3).
   */
  reopen(): void {
    if (this.disposed) return;
    this.releasePort();
    this.open();
  }

  send(envelope: BusEnvelope): void {
    if (this.disposed) return;
    if (this.port !== null) {
      this.port.postMessage(envelope);
      return;
    }
    if (this.queued.length >= MAX_QUEUED_BEFORE_PORT) return;
    this.queued.push(envelope);
    this.open();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.win.removeEventListener('message', this.onMessage);
    this.releasePort();
    this.queued = [];
  }

  private adopt(port: MessagePort): void {
    this.setupInFlight = false;
    this.releasePort();
    this.port = port;
    port.onmessage = (event: MessageEvent): void => {
      const data = event.data as unknown;
      if (!isBusEnvelope(data)) return;
      this.onInbound(data);
    };
    port.start?.();
    this.clearRetry();
    const pending = this.queued;
    this.queued = [];
    for (let i = 0; i < pending.length; i++) port.postMessage(pending[i]!);
  }

  private releasePort(): void {
    this.clearRetry();
    this.setupInFlight = false;
    if (this.port === null) return;
    this.port.onmessage = null;
    this.port.close();
    this.port = null;
  }

  private postSetup(): void {
    this.setupInFlight = true;
    const setup: BusPortSetupMessage = { channel: CONTEXT_BUS_CHANNEL, kind: BUS_PORT_SETUP };
    try {
      this.parent.postMessage(setup, '*');
    } catch {
      this.setupInFlight = false;
      /* parent gone — the initContext timeout is the answer (dormant) */
    }
  }

  private armRetry(): void {
    if (this.retryTimer !== null || this.setupRetryMs <= 0) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.disposed || this.port !== null) return;
      // Previous setup was lost (parent not listening yet) — allow one more.
      this.setupInFlight = false;
      this.postSetup();
      this.armRetry();
    }, this.setupRetryMs);
    // Never hold a nested document open on the retry beat.
    (this.retryTimer as unknown as { unref?: () => void }).unref?.();
  }

  private clearRetry(): void {
    if (this.retryTimer === null) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}