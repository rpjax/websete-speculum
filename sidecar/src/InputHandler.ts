import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Injects input events via xdotool, targeting a specific X11 display.
 *
 * xdotool sends events through the X11 server directly — Chrome receives them
 * identically to physical hardware events. This is more undetectable than CDP
 * Input.dispatchMouseEvent, which generates events with server-side timestamps
 * that can be fingerprinted by behaviour-analysis scripts.
 *
 * All methods are fire-and-forget (no await needed at call sites) but the
 * underlying execFile is awaited internally to serialise commands per session.
 * Pass the display number (e.g. 100 for :100) as the first argument.
 */

// xdotool button indices: 1=left, 2=middle, 3=right, 4=wheel-up, 5=wheel-down
const BUTTON_MAP: Record<number, number> = { 0: 1, 1: 2, 2: 3 };

function xdo(display: number, args: string[]): Promise<void> {
    return execFileAsync('xdotool', args, {
        env: { ...process.env, DISPLAY: `:${display}` },
    }).then(() => undefined).catch(err => {
        // Log but never throw — a failed xdotool call should not crash the session.
        console.warn(`[xdotool :${display}]`, args.join(' '), '—', (err as Error).message);
    });
}

export function mouseMove(display: number, x: number, y: number): Promise<void> {
    return xdo(display, ['mousemove', '--sync', String(x), String(y)]);
}

export function mouseDown(display: number, x: number, y: number, button: number): Promise<void> {
    const btn = BUTTON_MAP[button] ?? 1;
    return xdo(display, ['mousemove', '--sync', String(x), String(y), 'mousedown', String(btn)]);
}

export function mouseUp(display: number, x: number, y: number, button: number): Promise<void> {
    const btn = BUTTON_MAP[button] ?? 1;
    return xdo(display, ['mousemove', '--sync', String(x), String(y), 'mouseup', String(btn)]);
}

/**
 * Scroll via xdotool button clicks.
 * Button 4 = scroll up, Button 5 = scroll down (standard X11 convention).
 * We clamp deltaY to a reasonable number of clicks (1 click per 40 px).
 */
export function scroll(
    display: number,
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
): Promise<void> {
    const args: string[] = ['mousemove', '--sync', String(x), String(y)];

    const clicksY = Math.max(1, Math.round(Math.abs(deltaY) / 40));
    const btnY    = deltaY > 0 ? '5' : '4'; // positive deltaY = scroll down

    const clicksX = Math.max(1, Math.round(Math.abs(deltaX) / 40));
    const btnX    = deltaX > 0 ? '7' : '6'; // button 6/7 for horizontal scroll

    for (let i = 0; i < clicksY; i++) args.push('click', btnY);
    for (let i = 0; i < clicksX && deltaX !== 0; i++) args.push('click', btnX);

    return xdo(display, args);
}

/**
 * Maps common DOM key names to xdotool key names.
 * Unmapped keys pass through verbatim (xdotool accepts many names directly).
 */
const KEY_MAP: Record<string, string> = {
    ' ':           'space',
    'Enter':       'Return',
    'Backspace':   'BackSpace',
    'Delete':      'Delete',
    'Tab':         'Tab',
    'Escape':      'Escape',
    'ArrowLeft':   'Left',
    'ArrowRight':  'Right',
    'ArrowUp':     'Up',
    'ArrowDown':   'Down',
    'Home':        'Home',
    'End':         'End',
    'PageUp':      'Prior',
    'PageDown':    'Next',
    'F1':  'F1',  'F2':  'F2',  'F3':  'F3',  'F4':  'F4',
    'F5':  'F5',  'F6':  'F6',  'F7':  'F7',  'F8':  'F8',
    'F9':  'F9',  'F10': 'F10', 'F11': 'F11', 'F12': 'F12',
    'Control':     'ctrl',
    'Shift':       'shift',
    'Alt':         'alt',
    'Meta':        'super',
    'CapsLock':    'Caps_Lock',
};

function mapKey(domKey: string): string {
    return KEY_MAP[domKey] ?? domKey;
}

export function keyDown(display: number, domKey: string): Promise<void> {
    return xdo(display, ['keydown', mapKey(domKey)]);
}

export function keyUp(display: number, domKey: string): Promise<void> {
    return xdo(display, ['keyup', mapKey(domKey)]);
}

export function typeText(display: number, text: string): Promise<void> {
    // --clearmodifiers: releases any currently-held modifier keys before typing.
    // --delay 0: no inter-character delay (we rely on the event loop).
    return xdo(display, ['type', '--clearmodifiers', '--delay', '0', '--', text]);
}
