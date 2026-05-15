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

// ── Message type constants ────────────────────────────────────────────────────

export const MSG_TILE = 0x01;
export const MSG_FULL = 0x02;
export const MSG_SKIP = 0x03;
export const MSG_URL  = 0x04;  // URL update: sidecar → client

// ── Frame skip (1 byte) ───────────────────────────────────────────────────────

export const SKIP_FRAME = Buffer.from([MSG_SKIP]);

// ── Tile frame encoding ───────────────────────────────────────────────────────

export interface TileData {
    x:    number;  // uint16
    y:    number;  // uint16
    w:    number;  // uint16
    h:    number;  // uint16
    jpeg: Buffer;
}

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
export function encodeTileFrame(frameId: number, tiles: TileData[]): Buffer {
    // Pre-calculate total size.
    let size = 1 + 4 + 2; // type + frameId + numTiles
    for (const t of tiles) size += 2 + 2 + 2 + 2 + 4 + t.jpeg.length;

    const buf = Buffer.allocUnsafe(size);
    let off = 0;

    buf[off++] = MSG_TILE;
    buf.writeUInt32LE(frameId, off); off += 4;
    buf.writeUInt16LE(tiles.length, off); off += 2;

    for (const t of tiles) {
        buf.writeUInt16LE(t.x, off); off += 2;
        buf.writeUInt16LE(t.y, off); off += 2;
        buf.writeUInt16LE(t.w, off); off += 2;
        buf.writeUInt16LE(t.h, off); off += 2;
        buf.writeUInt32LE(t.jpeg.length, off); off += 4;
        t.jpeg.copy(buf, off); off += t.jpeg.length;
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
export function encodeFullFrame(frameId: number, jpeg: Buffer): Buffer {
    const buf = Buffer.allocUnsafe(1 + 4 + 4 + jpeg.length);
    let off = 0;

    buf[off++] = MSG_FULL;
    buf.writeUInt32LE(frameId, off); off += 4;
    buf.writeUInt32LE(jpeg.length, off); off += 4;
    jpeg.copy(buf, off);

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
    | { type: 'goforward' };

export type CreateMessage = {
    type:      'create';
    sessionId: string;
    width:     number;
    height:    number;
    url?:      string;
};

export function decodeMessage(raw: string): InputEvent | CreateMessage | null {
    try {
        return JSON.parse(raw) as InputEvent | CreateMessage;
    } catch {
        return null;
    }
}
