"use strict";
/**
 * Binary wire protocol between sidecar and .NET relay.
 *
 * Sidecar → .NET (binary frames):
 *   [0x01] Tile frame  — only changed 128×128 tiles
 *   [0x02] Full frame  — complete JPEG (>60 % tiles dirty or first frame)
 *   [0x03] Frame skip  — no content changed (1 byte only)
 *
 * .NET → Sidecar (text JSON):
 *   Input events and control commands (navigate, resize, etc.)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MSG_H264 = exports.CONSOLE_LEVELS = exports.SKIP_FRAME = exports.MSG_EVAL_RESULT = exports.MSG_CONSOLE = exports.MSG_URL = exports.MSG_SKIP = exports.MSG_FULL = exports.MSG_TILE = void 0;
exports.encodeTileFrame = encodeTileFrame;
exports.encodeFullFrame = encodeFullFrame;
exports.encodeConsoleMessage = encodeConsoleMessage;
exports.encodeEvalResult = encodeEvalResult;
exports.encodeUrlUpdate = encodeUrlUpdate;
exports.decodeMessage = decodeMessage;
exports.encodeH264Frame = encodeH264Frame;
// ── Message type constants ────────────────────────────────────────────────────
exports.MSG_TILE = 0x01;
exports.MSG_FULL = 0x02;
exports.MSG_SKIP = 0x03;
exports.MSG_URL = 0x04; // URL update:         sidecar → client
exports.MSG_CONSOLE = 0x05; // Virtual console log: sidecar → client
exports.MSG_EVAL_RESULT = 0x06; // vcon() result:       sidecar → client
// ── Frame skip (1 byte) ───────────────────────────────────────────────────────
exports.SKIP_FRAME = Buffer.from([exports.MSG_SKIP]);
/**
 * Encodes a tile frame message.
 *
 * Layout:
 *   [0]      type     = 0x01              (1 byte)
 *   [1..4]   frameId                      (4 bytes LE uint32)
 *   [5..6]   numTiles                     (2 bytes LE uint16)
 *   per tile:
 *     [+0..1] x                           (2 bytes LE uint16)
 *     [+2..3] y                           (2 bytes LE uint16)
 *     [+4..5] w                           (2 bytes LE uint16)
 *     [+6..7] h                           (2 bytes LE uint16)
 *     [+8..11] len                        (4 bytes LE uint32)
 *     [+12..] jpeg                        (len bytes)
 */
function encodeTileFrame(frameId, tiles) {
    // Pre-calculate total size.
    let size = 1 + 4 + 2; // type + frameId + numTiles
    for (const t of tiles)
        size += 2 + 2 + 2 + 2 + 4 + t.jpeg.length;
    const buf = Buffer.allocUnsafe(size);
    let off = 0;
    buf[off++] = exports.MSG_TILE;
    buf.writeUInt32LE(frameId, off);
    off += 4;
    buf.writeUInt16LE(tiles.length, off);
    off += 2;
    for (const t of tiles) {
        buf.writeUInt16LE(t.x, off);
        off += 2;
        buf.writeUInt16LE(t.y, off);
        off += 2;
        buf.writeUInt16LE(t.w, off);
        off += 2;
        buf.writeUInt16LE(t.h, off);
        off += 2;
        buf.writeUInt32LE(t.jpeg.length, off);
        off += 4;
        t.jpeg.copy(buf, off);
        off += t.jpeg.length;
    }
    return buf;
}
// ── Full frame encoding ───────────────────────────────────────────────────────
/**
 * Encodes a full-frame message.
 *
 * Layout:
 *   [0]      type     = 0x02              (1 byte)
 *   [1..4]   frameId                      (4 bytes LE uint32)
 *   [5..8]   len                          (4 bytes LE uint32)
 *   [9..]    jpeg                         (len bytes)
 */
function encodeFullFrame(frameId, jpeg) {
    const buf = Buffer.allocUnsafe(1 + 4 + 4 + jpeg.length);
    let off = 0;
    buf[off++] = exports.MSG_FULL;
    buf.writeUInt32LE(frameId, off);
    off += 4;
    buf.writeUInt32LE(jpeg.length, off);
    off += 4;
    jpeg.copy(buf, off);
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
function decodeMessage(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
// ── H.264 frame encoding (sidecar → .NET) ────────────────────────────────────
exports.MSG_H264 = 0x07;
/**
 * Encodes an H.264 frame for relay to .NET.
 * Layout: [0] 0x07 | [1] isKeyframe | [2..5] len LE | [6..] H.264 Annex B NAL units.
 */
function encodeH264Frame(isKeyframe, data) {
    const buf = Buffer.allocUnsafe(1 + 1 + 4 + data.length);
    buf[0] = exports.MSG_H264;
    buf[1] = isKeyframe ? 1 : 0;
    buf.writeUInt32LE(data.length, 2);
    data.copy(buf, 6);
    return buf;
}
