/**
 * Read SOF0/SOF2 dimensions from a JPEG buffer without decoding pixels.
 * Returns null if the buffer is not a recognizable JPEG.
 */
export function readJpegDimensions(buf: Buffer): { width: number; height: number } | null {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;

    let i = 2;
    while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
            i++;
            continue;
        }
        const marker = buf[i + 1]!;
        // Standalone markers without length
        if (marker === 0x00 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
            i += 2;
            continue;
        }
        if (i + 3 >= buf.length) return null;
        const segLen = (buf[i + 2]! << 8) | buf[i + 3]!;
        if (segLen < 2) return null;
        // SOF0 / SOF2 (baseline / progressive)
        if (marker === 0xc0 || marker === 0xc2) {
            if (i + 8 >= buf.length) return null;
            const height = (buf[i + 5]! << 8) | buf[i + 6]!;
            const width = (buf[i + 7]! << 8) | buf[i + 8]!;
            return { width, height };
        }
        i += 2 + segLen;
    }
    return null;
}
