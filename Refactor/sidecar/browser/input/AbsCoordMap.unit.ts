/**
 * Pure F(x) coordinate law tests — client CSS → ABS (D-UI-04).
 * Fail-closed, no Chrome/uinput/calibration.
 */

import assert from 'assert';
import {
  createCoordTransform,
  createLogicalWindowTransform,
  mapLogicalToAbs,
} from '../patchright/input/logical-to-device';

export function runAbsCoordMapUnitTests(): void {
  const t = createLogicalWindowTransform(800, 600);
  assert.strictEqual(t.logicalWidth, 800);
  assert.strictEqual(t.logicalHeight, 600);
  assert.strictEqual(t.absMaxX, 799);
  assert.strictEqual(t.absMaxY, 599);

  // Corners + center identity
  for (const [x, y] of [
    [0, 0],
    [799, 0],
    [0, 599],
    [799, 599],
    [400, 300],
    [1, 1],
    [798, 598],
  ] as const) {
    assert.deepStrictEqual(mapLogicalToAbs(t, x, y), { x, y }, `identity (${x},${y})`);
  }

  // Float rounding (banker's? — Math.round half-up toward +inf for .5)
  assert.deepStrictEqual(mapLogicalToAbs(t, 10.4, 20.6), { x: 10, y: 21 });
  assert.deepStrictEqual(mapLogicalToAbs(t, 10.5, 20.5), { x: 11, y: 21 });

  // Clamp OOB (writer safety net; Applier must reject before enqueue)
  assert.deepStrictEqual(mapLogicalToAbs(t, -1, 100), { x: 0, y: 100 });
  assert.deepStrictEqual(mapLogicalToAbs(t, 800, 600), { x: 799, y: 599 });
  assert.deepStrictEqual(mapLogicalToAbs(t, Number.NaN, 10), { x: 0, y: 10 }); // NaN → clamp path via Math.round(NaN)=NaN → max with 0

  // NaN/Inf: document actual clamp behaviour (Math.round(NaN) is NaN; clamp uses comparisons)
  const nanMapped = mapLogicalToAbs(t, Number.NaN, Number.POSITIVE_INFINITY);
  assert.ok(Number.isFinite(nanMapped.x) && Number.isFinite(nanMapped.y), 'NaN/Inf must not leak as ABS');

  // Over-alloc R: subset window still 1:1 into [0..W-1], never stretch to R
  const over = createCoordTransform(800, 600, 1279, 719);
  assert.deepStrictEqual(mapLogicalToAbs(over, 400, 300), { x: 400, y: 300 });
  const stretched = {
    x: Math.round((400 / 800) * 1279),
    y: Math.round((300 / 600) * 719),
  };
  assert.notDeepStrictEqual(mapLogicalToAbs(over, 400, 300), stretched);

  // Different viewport sizes
  const phone = createLogicalWindowTransform(390, 844);
  assert.deepStrictEqual(mapLogicalToAbs(phone, 195, 422), { x: 195, y: 422 });
  assert.strictEqual(phone.absMaxX, 389);
  assert.strictEqual(phone.absMaxY, 843);

  assert.throws(() => createLogicalWindowTransform(0, 600));
  assert.throws(() => createLogicalWindowTransform(800, -1));
  assert.throws(() => createCoordTransform(800, 600, -1, 100));

  // Hot-path cost: pure map must stay sub-µs class on a warm loop (lab host).
  const N = 200_000;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    mapLogicalToAbs(t, i % 800, (i * 7) % 600);
  }
  const ns = Number(process.hrtime.bigint() - t0);
  const nsPerOp = ns / N;
  // Generous ceiling: 2µs/op — if we ever regress to allocation-heavy map, this fails.
  assert.ok(nsPerOp < 2000, `mapLogicalToAbs too slow: ${nsPerOp.toFixed(2)} ns/op`);
  console.log(`[unit] abs coord map F(x) ok (${nsPerOp.toFixed(1)} ns/op, n=${N})`);
}
