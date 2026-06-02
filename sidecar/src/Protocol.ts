/**
 * Binary wire protocol between sidecar and .NET relay.
 *
 * Sidecar → .NET (binary frames):
 *   [0x04] MSG_URL         — virtual browser URL changed
 *   [0x05] MSG_CONSOLE     — console.* output from virtual page
 *   [0x06] MSG_EVAL_RESULT — result of a vcon() evaljs request
 *   [0x08] MSG_SCREENCAST  — JPEG frame from CDP Page.startScreencast
 *
 * .NET → Sidecar (text JSON):
 *   Input events and control commands (navigate, resize, evaljs, …)
 */

// ── Message type constants ────────────────────────────────────────────────────

export const MSG_URL         = 0x04;  // URL update:          sidecar → client
export const MSG_CONSOLE     = 0x05;  // Virtual console log: sidecar → client
export const MSG_EVAL_RESULT = 0x06;  // vcon() result:       sidecar → client
export const MSG_SCREENCAST  = 0x08;  // CDP JPEG screencast: sidecar → client

// ── Screencast frame encoding (sidecar → .NET) ────────────────────────────────

/**
 * Encodes a native CDP screencast frame (JPEG pushed by Chrome).
 * Layout: [0] 0x08 | [1..] jpeg bytes
 *
 * No length prefix needed — WebSocket frames are already message-delimited.
 */
export function encodeScreencastFrame(jpeg: Buffer): Buffer {
    const buf = Buffer.allocUnsafe(1 + jpeg.length);
    buf[0] = MSG_SCREENCAST;
    jpeg.copy(buf, 1);
    return buf;
}

// ── JsBridge: console message encoding (sidecar → client) ────────────────────

/**
 * Maps Playwright ConsoleMessage.type() strings to wire-level level bytes.
 * 0=log  1=warn  2=error  3=info  4=debug
 */
export const CONSOLE_LEVELS: Record<string, number> = {
    log:     0,
    warning: 1,
    warn:    1,
    error:   2,
    assert:  2,
    info:    3,
    debug:   4,
};

/**
 * Encodes a virtual browser console message.
 *
 * Layout:
 *   [0]     type  = 0x05            (1 byte)
 *   [1]     level = 0-4             (1 byte)
 *   [2..5]  len                     (4 bytes LE uint32)
 *   [6..]   text                    (len bytes UTF-8)
 */
export function encodeConsoleMessage(level: number, text: string): Buffer {
    const textBytes = Buffer.from(text, 'utf8');
    const buf       = Buffer.allocUnsafe(1 + 1 + 4 + textBytes.length);
    buf[0] = MSG_CONSOLE;
    buf[1] = level & 0xFF;
    buf.writeUInt32LE(textBytes.length, 2);
    textBytes.copy(buf, 6);
    return buf;
}

// ── JsBridge: eval result encoding (sidecar → client) ─────────────────────

/**
 * Encodes the result of a `vcon()` evaluation request.
 *
 * Layout:
 *   [0]     type  = 0x06            (1 byte)
 *   [1..4]  id                      (4 bytes LE uint32 — matches evaljs request)
 *   [5]     ok    = 1 ok / 0 error  (1 byte)
 *   [6..9]  len                     (4 bytes LE uint32)
 *   [10..]  value                   (len bytes UTF-8 — JSON result or error message)
 */
export function encodeEvalResult(id: number, ok: boolean, value: string): Buffer {
    const valueBytes = Buffer.from(value, 'utf8');
    const buf        = Buffer.allocUnsafe(1 + 4 + 1 + 4 + valueBytes.length);
    let off = 0;
    buf[off++] = MSG_EVAL_RESULT;
    buf.writeUInt32LE(id, off);  off += 4;
    buf[off++] = ok ? 1 : 0;
    buf.writeUInt32LE(valueBytes.length, off); off += 4;
    valueBytes.copy(buf, off);
    return buf;
}

// ── URL update encoding (sidecar → client, binary) ───────────────────────────

/**
 * Encodes a URL-update message.
 *
 * Layout:
 *   [0]      type    = 0x04              (1 byte)
 *   [1..4]   len                         (4 bytes LE uint32)
 *   [5..]    url                         (len bytes UTF-8)
 */
export function encodeUrlUpdate(url: string): Buffer {
    const urlBytes = Buffer.from(url, 'utf8');
    const buf = Buffer.allocUnsafe(1 + 4 + urlBytes.length);
    buf[0] = MSG_URL;
    buf.writeUInt32LE(urlBytes.length, 1);
    urlBytes.copy(buf, 5);
    return buf;
}

// ── Input event types (text JSON from .NET) ───────────────────────────────────

export type InputEvent =
    | { type: 'navigate';   url: string }
    | { type: 'mousemove';  x: number; y: number }
    | { type: 'mousedown';  x: number; y: number; button: number }
    | { type: 'mouseup';    x: number; y: number; button: number }
    | { type: 'wheel';      x: number; y: number; deltaX: number; deltaY: number }
    | { type: 'keydown';    key: string }
    | { type: 'keyup';      key: string }
    | { type: 'type';       text: string }
    | { type: 'resize';     width: number; height: number }
    | { type: 'refresh' }
    | { type: 'goback' }
    | { type: 'goforward' }
    /** JsBridge: execute JS in the virtual browser and return the result. */
    | { type: 'evaljs';     id: number; code: string };

// ── Script injection ──────────────────────────────────────────────────────────

/**
 * A single script to be injected into every page of the session.
 * Received from .NET as part of the "create" handshake payload.
 */
export type ScriptEntry = {
    /** Controls when the <script> element is appended to the DOM. */
    position: 'HeaderTop' | 'HeaderBottom' | 'BodyTop' | 'BodyBottom';
    /** Classic = no type attribute; Module = type="module". */
    type:     'Classic' | 'Module';
    /**
     * The wwwroot-relative URL path used as the script's src attribute
     * (e.g. "/libs/qrcode.js"). The sidecar serves this path from memory
     * when the virtual browser requests it from the current page's origin.
     */
    file:     string;
    /** Literal JavaScript source (read from disk by .NET at startup). */
    content:  string;
};

export type CreateMessage = {
    type:      'create';
    sessionId: string;
    width:     number;
    height:    number;
    url?:      string;
    /** Scripts to install via context.addInitScript() before the first navigation. */
    scripts?:  ScriptEntry[];
    /** When true, forward virtual console output and handle evaljs requests. */
    jsBridgeEnabled?: boolean;
};

export function decodeMessage(raw: string): InputEvent | CreateMessage | null {
    try {
        return JSON.parse(raw) as InputEvent | CreateMessage;
    } catch {
        return null;
    }
}
