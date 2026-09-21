#!/usr/bin/env python3
"""PNG RGBA non-white pixel ratio for same-S oracle."""
import json
import struct
import sys
import zlib


def main(path: str) -> None:
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    o = 8
    width = height = None
    idat = b""
    while o < len(data):
        ln = struct.unpack(">I", data[o : o + 4])[0]
        o += 4
        typ = data[o : o + 4]
        o += 4
        chunk = data[o : o + ln]
        o += ln + 4
        if typ == b"IHDR":
            width, height, bit, color, comp, filt, inter = struct.unpack(">IIBBBBB", chunk)
            if bit != 8 or color not in (2, 6):
                raise SystemExit(f"unsupported png color={color} bit={bit}")
        elif typ == b"IDAT":
            idat += chunk
        elif typ == b"IEND":
            break
    raw = zlib.decompress(idat)
    bpp = 4 if color == 6 else 3
    stride = width * bpp
    rows = []
    i = 0
    prev = bytearray(stride)

    def paeth(a, b, c):
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        if pa <= pb and pa <= pc:
            return a
        if pb <= pc:
            return b
        return c

    for _y in range(height):
        filt = raw[i]
        i += 1
        row = bytearray(raw[i : i + stride])
        i += stride
        if filt == 1:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + left) & 255
        elif filt == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + ((left + prev[x]) // 2)) & 255
        elif filt == 4:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                up = prev[x]
                ul = prev[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + paeth(left, up, ul)) & 255
        elif filt != 0:
            raise SystemExit(f"bad filter {filt}")
        rows.append(row)
        prev = row
    non_white = non_transparent = 0
    total = width * height
    for row in rows:
        for x in range(0, stride, bpp):
            if bpp == 4:
                r, g, b, a = row[x], row[x + 1], row[x + 2], row[x + 3]
            else:
                r, g, b, a = row[x], row[x + 1], row[x + 2], 255
            if a > 8:
                non_transparent += 1
            if a > 8 and (r < 250 or g < 250 or b < 250):
                non_white += 1
    print(
        json.dumps(
            {
                "width": width,
                "height": height,
                "total": total,
                "nonWhite": non_white,
                "nonTransparent": non_transparent,
                "nonWhiteRatio": (non_white / total) if total else 0,
            }
        )
    )


if __name__ == "__main__":
    main(sys.argv[1])
