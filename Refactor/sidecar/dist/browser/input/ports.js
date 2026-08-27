"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasDisplayInputDevices = hasDisplayInputDevices;
/** Structural check — an `IInputAdapter` either genuinely has this capability or it doesn't. */
function hasDisplayInputDevices(adapter) {
    return typeof adapter.displayInputDevices === 'function';
}
//# sourceMappingURL=ports.js.map