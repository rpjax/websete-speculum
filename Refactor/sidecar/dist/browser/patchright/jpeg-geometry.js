"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readJpegDimensions = readJpegDimensions;
/** Read JPEG SOF0/SOF2 dimensions without a full decode. */
function readJpegDimensions(jpeg) {
    const buf = Buffer.isBuffer(jpeg) ? jpeg : Buffer.from(jpeg);
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8)
        return null;
    let offset = 2;
    while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) {
            offset++;
            continue;
        }
        const marker = buf[offset + 1];
        if (marker === 0xd9 || marker === 0xda)
            break;
        const len = buf.readUInt16BE(offset + 2);
        if (len < 2 || offset + 2 + len > buf.length)
            break;
        if ((marker >= 0xc0 && marker <= 0xc3) ||
            (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) ||
            (marker >= 0xcd && marker <= 0xcf)) {
            const height = buf.readUInt16BE(offset + 5);
            const width = buf.readUInt16BE(offset + 7);
            return { width, height };
        }
        offset += 2 + len;
    }
    return null;
}
//# sourceMappingURL=jpeg-geometry.js.map