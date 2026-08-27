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

import { AbsOsInputStack, type AbsOsInputOpenOptions } from '../AbsOsInputStack';
import { AbsPointerPeripheral } from '../peripherals/AbsPointerPeripheral';
import { KeyboardPeripheral } from '../peripherals/KeyboardPeripheral';
import type { IInputAdapter, IDisplayInputDeviceProvider } from '../ports';

export function openOsAbsInputAdapter(opts: AbsOsInputOpenOptions): IInputAdapter & IDisplayInputDeviceProvider {
  const stack = AbsOsInputStack.open(opts);
  return {
    kind: 'os-abs',
    pointer: new AbsPointerPeripheral(stack.pointerWriter),
    keyboard: new KeyboardPeripheral(stack.keyboardWriter),
    displayInputDevices: () => stack.displayInputDevices(),
    setLogicalSize: (logicalWidth, logicalHeight) => stack.setLogicalSize(logicalWidth, logicalHeight),
    dispose: () => stack.dispose(),
  };
}
