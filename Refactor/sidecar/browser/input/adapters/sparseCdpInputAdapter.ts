/**
 * Sparse CDP-backed input adapter — sole PageProjection input path
 * (decision-log.md 2026-08-27).
 *
 * Closed catalog: `click` (single moveTo+press+release), a minimal keyboard set
 * (`Enter`/`Escape`/`Tab` plus single printable characters for `type`, sent via
 * `Input.insertText`). `scrollSet` goes through the session's loopback data plane
 * (`PageProjectionBrowserSession.applyScrollSet`) — adapter-agnostic, does not depend on
 * `pointer`/`keyboard`. Click *addressing* is id-based (`live-node-resolve`, see
 * `../clickDelivery.ts`), not this file's concern — this file only knows how to move a
 * pointer/press keys once given coordinates.
 *
 * No `displayInputDevices()` here on purpose: this adapter has no kernel input device at
 * all (dispatches straight into the CDP target), so it does not implement
 * `IDisplayInputDeviceProvider` (`../ports.ts`) — a fake stub returning empty device paths
 * used to live here and was deleted; a capability you don't have should be absent, not faked.
 *
 * Explicitly NOT supported: continuous pointer move / hover / drag. `moveTo` only
 * accepts one call per gesture (immediately followed by `button()`, matching
 * `EventApplier`'s `down`/`up` cases); a second bare `moveTo` without an intervening
 * `button()` — i.e. a raw `move` intent stream — is rejected as a no-op rather than
 * silently misbehaving. See docs/page-projection/spec/input.md §7.
 */

import type { IInputAdapter, IKeyboardPeripheral, IPointerPeripheral, PointerButton } from '../ports';

export type CdpSend = (method: string, params?: object) => Promise<unknown>;

export type SparseCdpInputOpenOptions = {
  // Method-shorthand (not `send: CdpSend`) so a real `CDPSession` (generic overloaded
  // `send<T extends keyof Protocol.CommandParameters>`) is bivariantly assignable here,
  // matching the convention `PatchrightInputBackend`'s `Cdp` type already uses.
  cdp: { send(method: string, params?: object): Promise<unknown> };
  logicalWidth: number;
  logicalHeight: number;
};

const BUTTON_MASK: Record<PointerButton, number> = { left: 1, right: 2, middle: 4 };

/**
 * Pointer catalog: `click` only. `moveTo` must be immediately followed by `button()`
 * (the shape `EventApplier` already uses for `down`/`up`); a second bare `moveTo`
 * before a `button()` call is treated as a continuous-move/hover/drag attempt and
 * dropped.
 */
export class SparseCdpPointerPeripheral implements IPointerPeripheral {
  private chain: Promise<void> = Promise.resolve();
  private lastX = 0;
  private lastY = 0;
  private awaitingButton = false;
  private rejectedMoves = 0;

  constructor(private readonly send: CdpSend) {}

  moveTo(x: number, y: number): void {
    if (this.awaitingButton) {
      this.rejectedMoves++;
      return;
    }
    this.awaitingButton = true;
    this.lastX = x;
    this.lastY = y;
    this.enqueue(() => this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }));
  }

  button(btn: PointerButton, down: boolean): void {
    this.awaitingButton = false;
    // Capture x/y NOW (synchronously) — `EventApplier.applyOne` fires `moveTo`+`button`
    // for several distinct targets back-to-back without awaiting the CDP round trip
    // (its pointer API is void/fire-and-forget). Reading `this.lastX`/`this.lastY` lazily
    // inside the enqueued closure raced against later `moveTo` calls already having
    // overwritten them, so a rapid multi-target click burst silently dispatched every
    // queued press/release at the LAST target's coordinates instead of its own. Found via
    // `input-e2e-stress` under load (clicks=0/1 of 4 expected) — never caught by the
    // same-coordinate down+up unit case. See docs/page-projection/spec/decision-log.md.
    const x = this.lastX;
    const y = this.lastY;
    this.enqueue(() =>
      this.send('Input.dispatchMouseEvent', {
        type: down ? 'mousePressed' : 'mouseReleased',
        x,
        y,
        button: btn,
        buttons: down ? BUTTON_MASK[btn] : 0,
        clickCount: 1,
      }),
    );
  }

  sanitize(): void {
    this.awaitingButton = false;
    const x = this.lastX;
    const y = this.lastY;
    this.enqueue(() =>
      this.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      }),
    );
  }

  /** @internal Fase 3 proof only — count of `moveTo` calls dropped as unsupported continuous move. */
  get rejectedContinuousMoveCount(): number {
    return this.rejectedMoves;
  }

  /** @internal test-only — await all CDP sends issued so far. */
  flush(): Promise<void> {
    return this.chain;
  }

  private enqueue(fn: () => Promise<unknown>): void {
    this.chain = this.chain.then(fn).then(
      () => undefined,
      () => undefined,
    );
  }
}

type CdpKeySpec = { key: string; code: string; windowsVirtualKeyCode: number; nativeVirtualKeyCode: number };

/** Minimum required catalog (task 3.1) — Enter/Escape/Tab must work end-to-end. */
const NAMED_KEYS: Record<string, CdpKeySpec> = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
};

/**
 * Keyboard catalog: `NAMED_KEYS` above plus single printable characters for `type`
 * (one `Input.insertText` per character on the down edge, mirroring
 * `PatchrightInputBackend.typeText`'s single-round-trip shape). Anything else is
 * rejected as a no-op rather than silently misbehaving.
 */
export class SparseCdpKeyboardPeripheral implements IKeyboardPeripheral {
  private chain: Promise<void> = Promise.resolve();
  private rejectedKeys = 0;

  constructor(private readonly send: CdpSend) {}

  key(
    code: string,
    down: boolean,
    modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean },
  ): void {
    const named = NAMED_KEYS[code];
    if (named) {
      this.enqueue(() =>
        this.send('Input.dispatchKeyEvent', {
          type: down ? 'keyDown' : 'keyUp',
          key: named.key,
          code: named.code,
          windowsVirtualKeyCode: named.windowsVirtualKeyCode,
          nativeVirtualKeyCode: named.nativeVirtualKeyCode,
          modifiers: cdpModifierBits(modifiers),
        }),
      );
      return;
    }
    if (code.length === 1) {
      if (down) this.enqueue(() => this.send('Input.insertText', { text: code }));
      return;
    }
    this.rejectedKeys++;
  }

  sanitize(): void {
    /* CDP key events are edge-triggered; nothing to release */
  }

  /** @internal Fase 3 proof only — count of `key()` calls dropped as outside the catalog. */
  get rejectedKeyCount(): number {
    return this.rejectedKeys;
  }

  /** @internal test-only — await all CDP sends issued so far. */
  flush(): Promise<void> {
    return this.chain;
  }

  private enqueue(fn: () => Promise<unknown>): void {
    this.chain = this.chain.then(fn).then(
      () => undefined,
      () => undefined,
    );
  }
}

function cdpModifierBits(modifiers?: {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}): number {
  let bits = 0;
  if (modifiers?.alt) bits |= 1;
  if (modifiers?.ctrl) bits |= 2;
  if (modifiers?.meta) bits |= 4;
  if (modifiers?.shift) bits |= 8;
  return bits;
}

export function openSparseCdpInputAdapter(opts: SparseCdpInputOpenOptions): IInputAdapter {
  // Bind — a real `CDPSession.send` reads internal instance state; extracting it as a
  // bare function value (as the fake-cdp unit test double allows) silently drops `this`
  // and fails closed inside patchright's bundle with an opaque `undefined` TypeError.
  const send: CdpSend = opts.cdp.send.bind(opts.cdp);
  const pointer = new SparseCdpPointerPeripheral(send);
  const keyboard = new SparseCdpKeyboardPeripheral(send);
  return {
    kind: 'sparse-cdp',
    pointer,
    keyboard,
    setLogicalSize(): void {
      // CDP mouse/key coordinates are dispatched in the same logical CSS pixel space
      // the caller already tracks — no ABS overalloc transform to recompute (D-UI-04
      // only applies to the uinput/`os-abs` coordinate law).
    },
    dispose(): void {
      /* no OS handles to release — CDP session lifecycle is owned by the caller */
    },
  };
}
