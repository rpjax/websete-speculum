"use strict";
/**
 * Sparse/minimal CDP-backed input adapter — CANONICAL DEFAULT (2026-08-27, Rodrigo
 * explicit ruling, see docs/page-projection/spec/decision-log.md). `os-abs`
 * ({@link ../adapters/osAbsInputAdapter.ts}) is frozen legacy, opt-in only.
 *
 * Closed catalog: `click` (single moveTo+press+release), a minimal keyboard set
 * (`Enter`/`Escape`/`Tab` plus single printable characters for `type`, sent via
 * `Input.insertText`). `scrollSet` goes through the session's loopback data plane
 * (`PageProjectionBrowserSession.applyScrollSet`) — adapter-agnostic, does not depend on
 * `pointer`/`keyboard`. Click *addressing* is id-based (`live-node-resolve`, see
 * `../clickDelivery.ts`), not this file's concern — this file only knows how to move a
 * pointer/press keys once given coordinates, same as `os-abs`.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SparseCdpKeyboardPeripheral = exports.SparseCdpPointerPeripheral = void 0;
exports.openSparseCdpInputAdapter = openSparseCdpInputAdapter;
const BUTTON_MASK = { left: 1, right: 2, middle: 4 };
/**
 * Pointer catalog: `click` only. `moveTo` must be immediately followed by `button()`
 * (the shape `EventApplier` already uses for `down`/`up`); a second bare `moveTo`
 * before a `button()` call is treated as a continuous-move/hover/drag attempt and
 * dropped.
 */
class SparseCdpPointerPeripheral {
    send;
    chain = Promise.resolve();
    lastX = 0;
    lastY = 0;
    awaitingButton = false;
    rejectedMoves = 0;
    constructor(send) {
        this.send = send;
    }
    moveTo(x, y) {
        if (this.awaitingButton) {
            this.rejectedMoves++;
            return;
        }
        this.awaitingButton = true;
        this.lastX = x;
        this.lastY = y;
        this.enqueue(() => this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }));
    }
    button(btn, down) {
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
        this.enqueue(() => this.send('Input.dispatchMouseEvent', {
            type: down ? 'mousePressed' : 'mouseReleased',
            x,
            y,
            button: btn,
            buttons: down ? BUTTON_MASK[btn] : 0,
            clickCount: 1,
        }));
    }
    sanitize() {
        this.awaitingButton = false;
        const x = this.lastX;
        const y = this.lastY;
        this.enqueue(() => this.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x,
            y,
            button: 'left',
            buttons: 0,
            clickCount: 1,
        }));
    }
    /** @internal Fase 3 proof only — count of `moveTo` calls dropped as unsupported continuous move. */
    get rejectedContinuousMoveCount() {
        return this.rejectedMoves;
    }
    /** @internal test-only — await all CDP sends issued so far. */
    flush() {
        return this.chain;
    }
    enqueue(fn) {
        this.chain = this.chain.then(fn).then(() => undefined, () => undefined);
    }
}
exports.SparseCdpPointerPeripheral = SparseCdpPointerPeripheral;
/** Minimum required catalog (task 3.1) — Enter/Escape/Tab must work end-to-end. */
const NAMED_KEYS = {
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
class SparseCdpKeyboardPeripheral {
    send;
    chain = Promise.resolve();
    rejectedKeys = 0;
    constructor(send) {
        this.send = send;
    }
    key(code, down, modifiers) {
        const named = NAMED_KEYS[code];
        if (named) {
            this.enqueue(() => this.send('Input.dispatchKeyEvent', {
                type: down ? 'keyDown' : 'keyUp',
                key: named.key,
                code: named.code,
                windowsVirtualKeyCode: named.windowsVirtualKeyCode,
                nativeVirtualKeyCode: named.nativeVirtualKeyCode,
                modifiers: cdpModifierBits(modifiers),
            }));
            return;
        }
        if (code.length === 1) {
            if (down)
                this.enqueue(() => this.send('Input.insertText', { text: code }));
            return;
        }
        this.rejectedKeys++;
    }
    sanitize() {
        /* CDP key events are edge-triggered; nothing to release */
    }
    /** @internal Fase 3 proof only — count of `key()` calls dropped as outside the catalog. */
    get rejectedKeyCount() {
        return this.rejectedKeys;
    }
    /** @internal test-only — await all CDP sends issued so far. */
    flush() {
        return this.chain;
    }
    enqueue(fn) {
        this.chain = this.chain.then(fn).then(() => undefined, () => undefined);
    }
}
exports.SparseCdpKeyboardPeripheral = SparseCdpKeyboardPeripheral;
function cdpModifierBits(modifiers) {
    let bits = 0;
    if (modifiers?.alt)
        bits |= 1;
    if (modifiers?.ctrl)
        bits |= 2;
    if (modifiers?.meta)
        bits |= 4;
    if (modifiers?.shift)
        bits |= 8;
    return bits;
}
function openSparseCdpInputAdapter(opts) {
    // Bind — a real `CDPSession.send` reads internal instance state; extracting it as a
    // bare function value (as the fake-cdp unit test double allows) silently drops `this`
    // and fails closed inside patchright's bundle with an opaque `undefined` TypeError.
    const send = opts.cdp.send.bind(opts.cdp);
    const pointer = new SparseCdpPointerPeripheral(send);
    const keyboard = new SparseCdpKeyboardPeripheral(send);
    return {
        kind: 'sparse-cdp',
        pointer,
        keyboard,
        setLogicalSize() {
            // CDP mouse/key coordinates are dispatched in the same logical CSS pixel space
            // the caller already tracks — no ABS overalloc transform to recompute (D-UI-04
            // only applies to the uinput/`os-abs` coordinate law).
        },
        dispose() {
            /* no OS handles to release — CDP session lifecycle is owned by the caller */
        },
    };
}
//# sourceMappingURL=sparseCdpInputAdapter.js.map