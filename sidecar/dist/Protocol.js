"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MSG_PROFILE_CHUNK = exports.MSG_REDIRECT = exports.MSG_STATUS = exports.CONSOLE_LEVELS = exports.MSG_SCREENCAST = exports.MSG_EVAL_RESULT = exports.MSG_CONSOLE = exports.MSG_URL = void 0;
exports.encodeScreencastFrame = encodeScreencastFrame;
exports.encodeConsoleMessage = encodeConsoleMessage;
exports.encodeEvalResult = encodeEvalResult;
exports.encodeUrlUpdate = encodeUrlUpdate;
exports.encodeStatusFrame = encodeStatusFrame;
exports.encodeRedirectFrame = encodeRedirectFrame;
exports.decodeMessage = decodeMessage;
// ── Message type constants ────────────────────────────────────────────────────
exports.MSG_URL = 0x04; // URL update:          sidecar → client
exports.MSG_CONSOLE = 0x05; // Virtual console log: sidecar → client
exports.MSG_EVAL_RESULT = 0x06; // vcon() result:       sidecar → client
exports.MSG_SCREENCAST = 0x08; // CDP JPEG screencast: sidecar → client
// ── Screencast frame encoding (sidecar → .NET) ────────────────────────────────
/**
 * Encodes a native CDP screencast frame (JPEG pushed by Chrome).
 * Layout: [0] 0x08 | [1..] jpeg bytes
 *
 * No length prefix needed — WebSocket frames are already message-delimited.
 */
function encodeScreencastFrame(jpeg) {
    const buf = Buffer.allocUnsafe(1 + jpeg.length);
    buf[0] = exports.MSG_SCREENCAST;
    jpeg.copy(buf, 1);
    return buf;
}
// ── JsBridge: console message encoding (sidecar → client) ────────────────────
/**
 * Maps Playwright ConsoleMessage.type() strings to wire-level level bytes.
 * 0=log  1=warn  2=error  3=info  4=debug
 */
exports.CONSOLE_LEVELS = {
    log: 0,
    warning: 1,
    warn: 1,
    error: 2,
    assert: 2,
    info: 3,
    debug: 4,
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
function encodeConsoleMessage(level, text) {
    const textBytes = Buffer.from(text, 'utf8');
    const buf = Buffer.allocUnsafe(1 + 1 + 4 + textBytes.length);
    buf[0] = exports.MSG_CONSOLE;
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
function encodeEvalResult(id, ok, value) {
    const valueBytes = Buffer.from(value, 'utf8');
    const buf = Buffer.allocUnsafe(1 + 4 + 1 + 4 + valueBytes.length);
    let off = 0;
    buf[off++] = exports.MSG_EVAL_RESULT;
    buf.writeUInt32LE(id, off);
    off += 4;
    buf[off++] = ok ? 1 : 0;
    buf.writeUInt32LE(valueBytes.length, off);
    off += 4;
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
function encodeUrlUpdate(url) {
    const urlBytes = Buffer.from(url, 'utf8');
    const buf = Buffer.allocUnsafe(1 + 4 + urlBytes.length);
    buf[0] = exports.MSG_URL;
    buf.writeUInt32LE(urlBytes.length, 1);
    urlBytes.copy(buf, 5);
    return buf;
}
// ── Session status (sidecar → .NET, binary) ──────────────────────────────────
exports.MSG_STATUS = 0x09;
exports.MSG_REDIRECT = 0x0A;
exports.MSG_PROFILE_CHUNK = 0x0B;
/**
 * Encodes a session status snapshot.
 *
 * Layout:
 *   [0]     type = 0x09          (1 byte)
 *   [1..4]  len                  (4 bytes LE uint32)
 *   [5..]   JSON payload         (len bytes UTF-8)
 */
function encodeStatusFrame(payload) {
    const json = JSON.stringify(payload);
    const jsonBytes = Buffer.from(json, 'utf8');
    const buf = Buffer.allocUnsafe(1 + 4 + jsonBytes.length);
    buf[0] = exports.MSG_STATUS;
    buf.writeUInt32LE(jsonBytes.length, 1);
    jsonBytes.copy(buf, 5);
    return buf;
}
// ── Navigation redirect (sidecar → .NET → client) ────────────────────────────
/**
 * Sent by the sidecar when the virtual browser tries to navigate outside the
 * upstream domain.  The .NET relay forwards it to the client, which performs
 * a real `window.location.href` redirect, closing the Speculum session and
 * taking the user directly to the intended destination.
 *
 * Layout (same as encodeUrlUpdate):
 *   [0]     type = 0x0A          (1 byte)
 *   [1..4]  len                  (4 bytes LE uint32)
 *   [5..]   url                  (len bytes UTF-8)
 */
function encodeRedirectFrame(url) {
    const urlBytes = Buffer.from(url, 'utf8');
    const buf = Buffer.allocUnsafe(1 + 4 + urlBytes.length);
    buf[0] = exports.MSG_REDIRECT;
    buf.writeUInt32LE(urlBytes.length, 1);
    urlBytes.copy(buf, 5);
    return buf;
}
function decodeMessage(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
