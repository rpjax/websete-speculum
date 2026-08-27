/**
 * Input adapter ports — the contract `PageProjectionBrowserSession` composes against
 * instead of hardcoding a specific input stack. Registered kinds: `os-abs` (frozen
 * legacy, {@link ../adapters/osAbsInputAdapter.ts}) and `sparse-cdp` (canonical default,
 * {@link ../adapters/sparseCdpInputAdapter.ts}) — see docs/page-projection/spec/decision-log.md
 * 2026-08-27 ("sparse-cdp canonical, os-abs frozen").
 *
 * Decomposed on purpose (2026-08-27 architecture pass) — each interface answers exactly
 * one question, and none of them encode *when* in a session's launch sequence they get
 * used. That sequencing lives in `PageProjectionBrowserSession.launch()`, not here.
 *
 * - `IInputAdapter` — "how do I move the mouse / press keys". Universal; every kind
 *   implements it.
 * - `IDisplayInputDeviceProvider` — "do I bind real kernel input devices the display
 *   server must know about before it starts". Narrow, optional; only kernel/uinput-bound
 *   kinds (`os-abs`) implement it. `sparse-cdp` dispatches straight into the CDP target
 *   and simply does not have this capability — it does not implement a stub for it either
 *   (a fake `displayInputDevices()` returning empty paths used to exist here; deleted,
 *   see decision-log.md — a contract nobody can meaningfully satisfy is itself a bug).
 *
 * Click *addressing* (census-coordinated vs live-node-resolve) is a separate, orthogonal
 * concern — see {@link ./clickDelivery.ts}. It is not part of `IInputAdapter`: how you move
 * the pointer and how you decide where to move it to are independent choices that happen
 * to correlate 1:1 with adapter kind today, not the same responsibility.
 */

import type { PointerButton } from './peripherals/AbsPointerPeripheral';
import type { IKeyboardPeripheral } from './peripherals/KeyboardPeripheral';
import type { DisplayInputDevices } from '../patchright/Display';

export type { PointerButton, IKeyboardPeripheral };

/**
 * Pointer peripheral contract. Same method shape as the current
 * `IAbsPointerPeripheral` ({@link ./peripherals/AbsPointerPeripheral.ts}), generalized
 * (no "Abs" prefix) so a CDP-backed pointer can also satisfy it.
 */
export interface IPointerPeripheral {
  moveTo(x: number, y: number): void;
  button(btn: PointerButton, down: boolean): void;
  sanitize(): void;
}

/**
 * The bundle a session composes at launch: how to move the pointer, how to press keys,
 * how to re-scale on resize, how to tear down. Nothing about scroll, click addressing,
 * or display binding — those are separate contracts (see file header).
 */
export interface IInputAdapter {
  readonly kind: string;
  readonly pointer: IPointerPeripheral;
  readonly keyboard: IKeyboardPeripheral;
  setLogicalSize(logicalWidth: number, logicalHeight: number): void;
  dispose(): void;
}

/**
 * Narrow, optional capability: adapters that bind real kernel input devices the display
 * server (Xorg) must be configured with *before* it starts. Only `os-abs` implements this
 * — `sparse-cdp` has no kernel device at all, so it does not implement this interface,
 * rather than faking one.
 */
export interface IDisplayInputDeviceProvider {
  displayInputDevices(): DisplayInputDevices;
}

/** Structural check — an `IInputAdapter` either genuinely has this capability or it doesn't. */
export function hasDisplayInputDevices(
  adapter: IInputAdapter,
): adapter is IInputAdapter & IDisplayInputDeviceProvider {
  return typeof (adapter as Partial<IDisplayInputDeviceProvider>).displayInputDevices === 'function';
}
