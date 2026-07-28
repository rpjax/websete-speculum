import type { CDPSession, Page } from 'patchright';
import type { BrowserInput, BrowserTouchPoint } from '../BrowserSession';

function mouseButtonName(b: number): 'left' | 'middle' | 'right' | 'none' {
  if (b === 1) return 'middle';
  if (b === 2) return 'right';
  if (b === 0) return 'left';
  return 'none';
}

function mouseButtonMask(b: number): number {
  if (b === 0) return 1;
  if (b === 1) return 4;
  if (b === 2) return 2;
  return 0;
}

function cdpTouchType(phase: string): 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel' {
  switch (phase) {
    case 'move':
      return 'touchMove';
    case 'end':
      return 'touchEnd';
    case 'cancel':
      return 'touchCancel';
    default:
      return 'touchStart';
  }
}

/** CDP Input.modifiers bitmask (matches Chromium / Playwright). */
function modifiersMask(pressed: ReadonlySet<string>): number {
  let mask = 0;
  if (pressed.has('Alt')) mask |= 1;
  if (pressed.has('Control')) mask |= 2;
  if (pressed.has('Meta')) mask |= 4;
  if (pressed.has('Shift')) mask |= 8;
  return mask;
}

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift']);

/**
 * US layout defs keyed by KeyboardEvent.key (what the Sessions client sends).
 * Without windowsVirtualKeyCode/code, Blink skips editing defaults (Backspace, arrows, …).
 * Sourced from Playwright usKeyboardLayout (code name === key for these).
 */
type KeyDef = { keyCode: number; code: string; text?: string };

const KEY_DEFS: Record<string, KeyDef> = {
  Backspace: { keyCode: 8, code: 'Backspace' },
  Tab: { keyCode: 9, code: 'Tab', text: '\t' },
  Enter: { keyCode: 13, code: 'Enter', text: '\r' },
  Escape: { keyCode: 27, code: 'Escape' },
  ' ': { keyCode: 32, code: 'Space', text: ' ' },
  PageUp: { keyCode: 33, code: 'PageUp' },
  PageDown: { keyCode: 34, code: 'PageDown' },
  End: { keyCode: 35, code: 'End' },
  Home: { keyCode: 36, code: 'Home' },
  ArrowLeft: { keyCode: 37, code: 'ArrowLeft' },
  ArrowUp: { keyCode: 38, code: 'ArrowUp' },
  ArrowRight: { keyCode: 39, code: 'ArrowRight' },
  ArrowDown: { keyCode: 40, code: 'ArrowDown' },
  Insert: { keyCode: 45, code: 'Insert' },
  Delete: { keyCode: 46, code: 'Delete' },
  Shift: { keyCode: 16, code: 'ShiftLeft' },
  Control: { keyCode: 17, code: 'ControlLeft' },
  Alt: { keyCode: 18, code: 'AltLeft' },
  Meta: { keyCode: 91, code: 'MetaLeft' },
  ContextMenu: { keyCode: 93, code: 'ContextMenu' },
  F1: { keyCode: 112, code: 'F1' },
  F2: { keyCode: 113, code: 'F2' },
  F3: { keyCode: 114, code: 'F3' },
  F4: { keyCode: 115, code: 'F4' },
  F5: { keyCode: 116, code: 'F5' },
  F6: { keyCode: 117, code: 'F6' },
  F7: { keyCode: 118, code: 'F7' },
  F8: { keyCode: 119, code: 'F8' },
  F9: { keyCode: 120, code: 'F9' },
  F10: { keyCode: 121, code: 'F10' },
  F11: { keyCode: 122, code: 'F11' },
  F12: { keyCode: 123, code: 'F12' },
};

/** Text for Input.dispatchKeyEvent so Enter/Tab/printable trigger insert defaults. */
function keyText(key: string, def: KeyDef | undefined): string | undefined {
  if (def?.text !== undefined) return def.text;
  if (key.length === 1) return key;
  return undefined;
}

function resolveKeyDef(key: string): KeyDef | undefined {
  const known = KEY_DEFS[key];
  if (known) return known;
  if (key.length !== 1) return undefined;
  // Printable: Digit/letter code is best-effort (insertion uses text).
  const upper = key.toUpperCase();
  if (key >= 'a' && key <= 'z') {
    return { keyCode: upper.charCodeAt(0), code: `Key${upper}` };
  }
  if (key >= 'A' && key <= 'Z') {
    return { keyCode: key.charCodeAt(0), code: `Key${key}` };
  }
  if (key >= '0' && key <= '9') {
    return { keyCode: key.charCodeAt(0), code: `Digit${key}` };
  }
  return { keyCode: key.charCodeAt(0), code: '' };
}

/**
 * Pointer/key/touch → Chrome Input.* domain, fire-and-forget.
 * Does not await CDP; does not serialize behind navigate/resize.
 * History nav is also non-blocking (void) so it cannot stall the input path.
 */
export class InputController {
  private _page: Page;
  private _cdp: CDPSession;
  private _touchPrimary = false;
  private _buttons = 0;
  private _movePending: { x: number; y: number } | null = null;
  private _moveScheduled = false;
  private _inFlight = 0;
  private _pressedModifiers = new Set<string>();

  constructor(page: Page, cdp: CDPSession) {
    this._page = page;
    this._cdp = cdp;
  }

  rebind(page: Page, cdp: CDPSession): void {
    this._page = page;
    this._cdp = cdp;
    this._pressedModifiers.clear();
  }

  setTouchPrimary(value: boolean): void {
    this._touchPrimary = value;
  }

  /** Admission is synchronous — CDP work is scheduled without awaiting. */
  enqueue(input: BrowserInput): void {
    try {
      this.dispatch(input);
    } catch (err) {
      console.warn('[Input] error:', (err as Error).message);
    }
  }

  dispatch(input: BrowserInput): void {
    switch (input.type) {
      case 'mousemove':
        if (this._touchPrimary) return;
        this._queueMouseMove(input.x, input.y);
        return;
      case 'mousedown':
        if (this._touchPrimary) return;
        this._buttons |= mouseButtonMask(input.button);
        this._sendMouse('mousePressed', input.x, input.y, input.button, 1);
        return;
      case 'mouseup':
        if (this._touchPrimary) return;
        this._buttons &= ~mouseButtonMask(input.button);
        this._sendMouse('mouseReleased', input.x, input.y, input.button, 1);
        return;
      case 'wheel':
        if (this._touchPrimary) {
          this._sendWheel(input.x, input.y, input.deltaX, input.deltaY);
          return;
        }
        this._sendMouse('mouseMoved', input.x, input.y, -1, 0);
        this._sendWheel(input.x, input.y, input.deltaX, input.deltaY);
        return;
      case 'keydown':
        this._sendKey('keyDown', input.key);
        return;
      case 'keyup':
        this._sendKey('keyUp', input.key);
        return;
      case 'type':
      case 'text':
        this._ff('Input.insertText', { text: input.text });
        return;
      case 'touch':
        this._dispatchTouch(input.phase, [...input.points]);
        return;
      case 'goback':
        // History is not pointer/key — never await on the input path.
        void this._page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((err) => {
          console.warn('[Input] goback:', (err as Error).message);
        });
        return;
      case 'goforward':
        void this._page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((err) => {
          console.warn('[Input] goforward:', (err as Error).message);
        });
        return;
    }
  }

  private _queueMouseMove(x: number, y: number): void {
    this._movePending = { x, y };
    if (this._moveScheduled) return;
    this._moveScheduled = true;
    setImmediate(() => {
      this._moveScheduled = false;
      const p = this._movePending;
      this._movePending = null;
      if (!p || this._touchPrimary) return;
      this._sendMouse('mouseMoved', p.x, p.y, -1, 0);
    });
  }

  private _sendMouse(
    type: 'mousePressed' | 'mouseReleased' | 'mouseMoved',
    x: number,
    y: number,
    button: number,
    clickCount: number,
  ): void {
    this._ff('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: type === 'mouseMoved' ? 'none' : mouseButtonName(button),
      buttons: this._buttons,
      clickCount,
      modifiers: modifiersMask(this._pressedModifiers),
    });
  }

  private _sendWheel(x: number, y: number, deltaX: number, deltaY: number): void {
    this._ff('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX,
      deltaY,
      button: 'none',
      buttons: this._buttons,
      modifiers: modifiersMask(this._pressedModifiers),
    });
  }

  private _sendKey(type: 'keyDown' | 'keyUp', key: string): void {
    // Match Playwright: modifiers set before down, cleared before up.
    if (type === 'keyDown' && MODIFIER_KEYS.has(key)) {
      this._pressedModifiers.add(key);
    } else if (type === 'keyUp' && MODIFIER_KEYS.has(key)) {
      this._pressedModifiers.delete(key);
    }

    const def = resolveKeyDef(key);
    // Insert text only with no modifiers, or Shift alone (Playwright US layout rule).
    const allowText =
      this._pressedModifiers.size === 0 ||
      (this._pressedModifiers.size === 1 && this._pressedModifiers.has('Shift'));
    const text = type === 'keyDown' && allowText ? keyText(key, def) : undefined;

    const params: Record<string, unknown> = {
      type: text && type === 'keyDown' ? 'keyDown' : type === 'keyDown' ? 'rawKeyDown' : 'keyUp',
      key,
      modifiers: modifiersMask(this._pressedModifiers),
    };
    if (def) {
      params.code = def.code;
      params.windowsVirtualKeyCode = def.keyCode;
      params.nativeVirtualKeyCode = def.keyCode;
    }
    if (text) {
      params.text = text;
      params.unmodifiedText = text;
    }
    this._ff('Input.dispatchKeyEvent', params);
  }

  private _dispatchTouch(phase: string, points: BrowserTouchPoint[]): void {
    const type = cdpTouchType(phase);
    if (type === 'touchEnd' || type === 'touchCancel') {
      this._ff('Input.dispatchTouchEvent', { type, touchPoints: [] });
      if (points.length > 0) {
        this._ff('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: points.map((p) => ({
            x: p.x,
            y: p.y,
            id: p.id,
            radiusX: p.radiusX,
            radiusY: p.radiusY,
            force: p.force,
          })),
        });
      }
      return;
    }

    this._ff('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({
        x: p.x,
        y: p.y,
        id: p.id,
        radiusX: p.radiusX,
        radiusY: p.radiusY,
        force: p.force,
      })),
    });
  }

  private _ff(method: string, params: Record<string, unknown>): void {
    this._inFlight++;
    void (this._cdp as { send(method: string, params?: object): Promise<unknown> })
      .send(method, params)
      .catch((err: unknown) => {
        console.warn(`[Input] ${method}:`, (err as Error).message);
      })
      .finally(() => {
        this._inFlight = Math.max(0, this._inFlight - 1);
      });
  }

  get pendingCount(): number {
    return this._inFlight + (this._movePending ? 1 : 0);
  }
}
