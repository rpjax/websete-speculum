"use strict";
/**
 * Pure F(x) coordinate law tests — client CSS → ABS (D-UI-04).
 * Fail-closed, no Chrome/uinput/calibration.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAbsCoordMapUnitTests = runAbsCoordMapUnitTests;
exports.testAbsOsInputOverallocTransform = testAbsOsInputOverallocTransform;
const assert_1 = __importDefault(require("assert"));
const logical_to_device_1 = require("../patchright/input/logical-to-device");
function runAbsCoordMapUnitTests() {
    const t = (0, logical_to_device_1.createLogicalWindowTransform)(800, 600);
    assert_1.default.strictEqual(t.logicalWidth, 800);
    assert_1.default.strictEqual(t.logicalHeight, 600);
    assert_1.default.strictEqual(t.absMaxX, 799);
    assert_1.default.strictEqual(t.absMaxY, 599);
    // Corners + center identity
    for (const [x, y] of [
        [0, 0],
        [799, 0],
        [0, 599],
        [799, 599],
        [400, 300],
        [1, 1],
        [798, 598],
    ]) {
        assert_1.default.deepStrictEqual((0, logical_to_device_1.mapLogicalToAbs)(t, x, y), { x, y }, `identity (${x},${y})`);
    }
    // Float rounding (banker's? — Math.round half-up toward +inf for .5)
    assert_1.default.deepStrictEqual((0, logical_to_device_1.mapLogicalToAbs)(t, 10.4, 20.6), { x: 10, y: 21 });
    assert_1.default.deepStrictEqual((0, logical_to_device_1.mapLogicalToAbs)(t, 10.5, 20.5), { x: 11, y: 21 });
    // Clamp OOB (writer safety net; Applier must reject before enqueue)
    assert_1.default.deepStrictEqual((0, logical_to_device_1.mapLogicalToAbs)(t, -1, 100), { x: 0, y: 100 });
    assert_1.default.deepStrictEqual((0, logical_to_device_1.mapLogicalToAbs)(t, 800, 600), { x: 799, y: 599 });
    assert_1.default.deepStrictEqual((0, logical_to_device_1.mapLogicalToAbs)(t, Number.NaN, 10), { x: 0, y: 10 }); // NaN → clamp path via Math.round(NaN)=NaN → max with 0
    // NaN/Inf: document actual clamp behaviour (Math.round(NaN) is NaN; clamp uses comparisons)
    const nanMapped = (0, logical_to_device_1.mapLogicalToAbs)(t, Number.NaN, Number.POSITIVE_INFINITY);
    assert_1.default.ok(Number.isFinite(nanMapped.x) && Number.isFinite(nanMapped.y), 'NaN/Inf must not leak as ABS');
    // Over-alloc R: subset window still 1:1 into [0..W-1], never stretch to R
    const over = (0, logical_to_device_1.createCoordTransform)(800, 600, 1279, 719);
    assert_1.default.deepStrictEqual((0, logical_to_device_1.mapLogicalToAbs)(over, 400, 300), { x: 400, y: 300 });
    const stretched = {
        x: Math.round((400 / 800) * 1279),
        y: Math.round((300 / 600) * 719),
    };
    assert_1.default.notDeepStrictEqual((0, logical_to_device_1.mapLogicalToAbs)(over, 400, 300), stretched);
    // Different viewport sizes
    const phone = (0, logical_to_device_1.createLogicalWindowTransform)(390, 844);
    assert_1.default.deepStrictEqual((0, logical_to_device_1.mapLogicalToAbs)(phone, 195, 422), { x: 195, y: 422 });
    assert_1.default.strictEqual(phone.absMaxX, 389);
    assert_1.default.strictEqual(phone.absMaxY, 843);
    assert_1.default.throws(() => (0, logical_to_device_1.createLogicalWindowTransform)(0, 600));
    assert_1.default.throws(() => (0, logical_to_device_1.createLogicalWindowTransform)(800, -1));
    assert_1.default.throws(() => (0, logical_to_device_1.createCoordTransform)(800, 600, -1, 100));
    // Hot-path cost: pure map must stay sub-µs class on a warm loop (lab host).
    const N = 200_000;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) {
        (0, logical_to_device_1.mapLogicalToAbs)(t, i % 800, (i * 7) % 600);
    }
    const ns = Number(process.hrtime.bigint() - t0);
    const nsPerOp = ns / N;
    // Generous ceiling: 2µs/op — if we ever regress to allocation-heavy map, this fails.
    assert_1.default.ok(nsPerOp < 2000, `mapLogicalToAbs too slow: ${nsPerOp.toFixed(2)} ns/op`);
    console.log(`[unit] abs coord map F(x) ok (${nsPerOp.toFixed(1)} ns/op, n=${N})`);
}
/** AbsOsInputStack overalloc + setLogicalSize — resize must not clamp clicks to launch size. */
function testAbsOsInputOverallocTransform() {
    if (!process.env['SPECULUM_UNIT_UINPUT']) {
        console.log('[unit] AbsOsInputStack overalloc skipped (set SPECULUM_UNIT_UINPUT=1 on Linux)');
        return;
    }
    const { AbsOsInputStack } = require('./AbsOsInputStack');
    const stack = AbsOsInputStack.open({
        sessionId: 'unit-overalloc',
        displayWidth: 1280,
        displayHeight: 720,
        logicalWidth: 800,
        logicalHeight: 600,
    });
    try {
        let t = stack.getCoordTransform();
        assert_1.default.strictEqual(t.logicalWidth, 800);
        assert_1.default.strictEqual(t.absMaxX, 1279);
        assert_1.default.deepStrictEqual((0, logical_to_device_1.mapLogicalToAbs)(t, 799, 599), { x: 799, y: 599 });
        stack.setLogicalSize(1024, 768);
        t = stack.getCoordTransform();
        assert_1.default.strictEqual(t.logicalWidth, 1024);
        assert_1.default.strictEqual(t.absMaxX, 1279);
        assert_1.default.deepStrictEqual((0, logical_to_device_1.mapLogicalToAbs)(t, 900, 700), { x: 900, y: 700 });
        console.log('[unit] AbsOsInputStack overalloc transform ok');
    }
    finally {
        stack.dispose();
    }
}
//# sourceMappingURL=AbsCoordMap.unit.js.map