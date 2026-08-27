"use strict";
/**
 * `os-abs` input adapter — FROZEN LEGACY (2026-08-27, Rodrigo explicit ruling, see
 * docs/page-projection/spec/decision-log.md). No longer the default; opt-in only via
 * `pageProjectionInputAdapterKind: 'os-abs'` / lab CLI `--input-adapter os-abs`. Kept
 * for reference and rollback, code path unchanged since Fase 2.3 — do not extend, do not
 * fix census/perf issues here, do not add new call sites. `sparse-cdp`
 * ({@link ../adapters/sparseCdpInputAdapter.ts}) is the canonical path.
 *
 * Thin factory bundling exactly what `PageProjectionBrowserSession.launch()` did inline
 * before extraction: open {@link AbsOsInputStack}, wrap its writers in
 * `AbsPointerPeripheral` / `KeyboardPeripheral`. Implements `IDisplayInputDeviceProvider`
 * (real kernel uinput devices Xorg must bind before it starts) — the one capability
 * `sparse-cdp` does not and cannot have.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.openOsAbsInputAdapter = openOsAbsInputAdapter;
const AbsOsInputStack_1 = require("../AbsOsInputStack");
const AbsPointerPeripheral_1 = require("../peripherals/AbsPointerPeripheral");
const KeyboardPeripheral_1 = require("../peripherals/KeyboardPeripheral");
function openOsAbsInputAdapter(opts) {
    const stack = AbsOsInputStack_1.AbsOsInputStack.open(opts);
    return {
        kind: 'os-abs',
        pointer: new AbsPointerPeripheral_1.AbsPointerPeripheral(stack.pointerWriter),
        keyboard: new KeyboardPeripheral_1.KeyboardPeripheral(stack.keyboardWriter),
        displayInputDevices: () => stack.displayInputDevices(),
        setLogicalSize: (logicalWidth, logicalHeight) => stack.setLogicalSize(logicalWidth, logicalHeight),
        dispose: () => stack.dispose(),
    };
}
//# sourceMappingURL=osAbsInputAdapter.js.map