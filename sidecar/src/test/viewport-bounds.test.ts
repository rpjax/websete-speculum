import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStartViewport, validateResizeViewport } from '../browser/viewport-bounds';
import { readJpegDimensions } from '../browser/jpeg-geometry';

test('normalizeStartViewport maps 0×0 to defaults', () => {
    assert.deepEqual(normalizeStartViewport(0, 0), { width: 1280, height: 720 });
});

test('normalizeStartViewport keeps exact odd geometry', () => {
    assert.deepEqual(normalizeStartViewport(757, 715), { width: 757, height: 715 });
});

test('validateResizeViewport rejects below minimum', () => {
    const r = validateResizeViewport(50, 50);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /below minimum/);
});

test('validateResizeViewport accepts exact odd geometry', () => {
    const r = validateResizeViewport(757, 715);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual({ width: r.width, height: r.height }, { width: 757, height: 715 });
});

test('readJpegDimensions parses SOF0 width/height', () => {
    // Minimal JPEG with SOF0 declaring 757×715
    const buf = Buffer.from([
        0xff, 0xd8, // SOI
        0xff, 0xc0, // SOF0
        0x00, 0x0b, // length
        0x08,       // precision
        0x02, 0xcb, // height 715
        0x02, 0xf5, // width 757
        0x03,       // components
        0xff, 0xd9, // EOI
    ]);
    assert.deepEqual(readJpegDimensions(buf), { width: 757, height: 715 });
});
