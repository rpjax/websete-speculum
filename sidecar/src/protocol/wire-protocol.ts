/**
 * W7S Speculum sidecar wire protocol (canonical).
 * See docs/w7s-sidecar-protocol.md
 */

import type { BrowserStatePayload } from '../BrowserState';

export const MSG_URL         = 0x04;
export const MSG_CONSOLE     = 0x05;
export const MSG_EVAL_RESULT = 0x06;
export const MSG_SCREENCAST  = 0x08;
export const MSG_STATUS      = 0x09;
export const MSG_REDIRECT    = 0x0A;

export function encodeScreencastFrame(jpeg: Buffer): Buffer {
    const buf = Buffer.allocUnsafe(1 + jpeg.length);
    buf[0] = MSG_SCREENCAST;
    jpeg.copy(buf, 1);
    return buf;
}

export const CONSOLE_LEVELS: Record<string, number> = {
    log: 0, warning: 1, warn: 1, error: 2, assert: 2, info: 3, debug: 4,
};

export function encodeConsoleMessage(level: number, text: string): Buffer {
    const textBytes = Buffer.from(text, 'utf8');
    const buf       = Buffer.allocUnsafe(1 + 1 + 4 + textBytes.length);
    buf[0] = MSG_CONSOLE;
    buf[1] = level & 0xFF;
    buf.writeUInt32LE(textBytes.length, 2);
    textBytes.copy(buf, 6);
    return buf;
}

export function encodeEvalResult(id: number, ok: boolean, value: string): Buffer {
    const valueBytes = Buffer.from(value, 'utf8');
    const buf        = Buffer.allocUnsafe(1 + 4 + 1 + 4 + valueBytes.length);
    let off = 0;
    buf[off++] = MSG_EVAL_RESULT;
    buf.writeUInt32LE(id, off); off += 4;
    buf[off++] = ok ? 1 : 0;
    buf.writeUInt32LE(valueBytes.length, off); off += 4;
    valueBytes.copy(buf, off);
    return buf;
}

export function encodeUrlUpdate(url: string): Buffer {
    const urlBytes = Buffer.from(url, 'utf8');
    const buf = Buffer.allocUnsafe(1 + 4 + urlBytes.length);
    buf[0] = MSG_URL;
    buf.writeUInt32LE(urlBytes.length, 1);
    urlBytes.copy(buf, 5);
    return buf;
}

export type TouchPoint = {
    id: number;
    x: number;
    y: number;
    radiusX?: number;
    radiusY?: number;
    force?: number;
};

export type TouchEvent = {
    type: 'touch';
    phase: 'start' | 'move' | 'end' | 'cancel';
    points: TouchPoint[];
    changedIds: number[];
};

export type TextInputEvent = {
    type: 'text';
    text: string;
    source?: string;
};

export type InputEvent =
    | { type: 'navigate';   url: string }
    | { type: 'mousemove';  x: number; y: number }
    | { type: 'mousedown';  x: number; y: number; button: number }
    | { type: 'mouseup';    x: number; y: number; button: number }
    | { type: 'wheel';      x: number; y: number; deltaX: number; deltaY: number }
    | { type: 'keydown';    key: string }
    | { type: 'keyup';      key: string }
    | { type: 'type';       text: string }
    | TextInputEvent
    | TouchEvent
    | {
        type: 'resize';
        width: number;
        height: number;
        mobile?: boolean;
        touch?: boolean;
        deviceScaleFactor?: number;
        maxTouchPoints?: number;
        userAgentProfile?: string;
        screenOrientation?: string;
      }
    | { type: 'refresh' }
    | { type: 'goback' }
    | { type: 'goforward' }
    | { type: 'evaljs';     id: number; code: string };

export type EditingState = {
    focused: boolean;
    inputMode?: string;
    multiline?: boolean;
    tagName?: string;
};

export type StatusPayload = {
    tabCount: number;
    url:      string;
    resizing: boolean;
    width:    number;
    height:   number;
    editing?: EditingState | null;
};

export function encodeStatusFrame(payload: StatusPayload): Buffer {
    const json      = JSON.stringify(payload);
    const jsonBytes = Buffer.from(json, 'utf8');
    const buf       = Buffer.allocUnsafe(1 + 4 + jsonBytes.length);
    buf[0] = MSG_STATUS;
    buf.writeUInt32LE(jsonBytes.length, 1);
    jsonBytes.copy(buf, 5);
    return buf;
}

export function encodeRedirectFrame(url: string): Buffer {
    const urlBytes = Buffer.from(url, 'utf8');
    const buf = Buffer.allocUnsafe(1 + 4 + urlBytes.length);
    buf[0] = MSG_REDIRECT;
    buf.writeUInt32LE(urlBytes.length, 1);
    urlBytes.copy(buf, 5);
    return buf;
}

export type ScriptEntry = {
    position: 'HeaderTop' | 'HeaderBottom' | 'BodyTop' | 'BodyBottom';
    type:     'Classic' | 'Module';
    file:     string;
    content:  string;
};

export type CreateMessage = {
    type:      'create';
    sessionId: string;
    width:     number;
    height:    number;
    url?:      string;
    browserState?: BrowserStatePayload;
    scripts?:  ScriptEntry[];
    jsBridgeEnabled?: boolean;
    allowedNavigationDomains?: string[];
    mobile?: boolean;
    touch?: boolean;
    deviceScaleFactor?: number;
    maxTouchPoints?: number;
    userAgentProfile?: string;
    screenOrientation?: string;
};

export type ExportStateMessage = { type: 'exportState' };

export type DiagProbeMessage = {
    type:               'diagProbe';
    requestId:          string;
    ops:                string[];
    evaluateExpression?: string;
    domSelector?:       string;
    maxProbeResponseBytes?: number;
};

export type DiagResultMessage = {
    type:       'diagResult';
    requestId:  string;
    ok:         boolean;
    errorCode?: string;
    data?:      object;
};

/** Sidecar → API error on create handshake. */
export type CreateErrorMessage = {
    type:      'error';
    sessionId: string;
    message:   string;
    errorCode: string;
};

/** Sidecar → API error on state export. */
export type StateExportErrorMessage = {
    type:      'stateExportError';
    message:   string;
    errorCode: string;
};

export type SidecarInboundMessage =
    | InputEvent
    | CreateMessage
    | ExportStateMessage
    | DiagProbeMessage;

export function decodeMessage(raw: string): SidecarInboundMessage | null {
    try {
        return JSON.parse(raw) as SidecarInboundMessage;
    } catch {
        return null;
    }
}
