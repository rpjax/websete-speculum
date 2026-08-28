/**
 * Projected iframes start as `about:blank` → `BackCompat`. DOM-inserted DOCTYPE does not
 * flip the mode (K4). Full CSS1Compat boot (srcdoc) is tracked separately; until then
 * {@link installStandardsMarginParity} bridges common UA margin drift.
 */

/** No-op while surfaces stay on about:blank + standards margin parity. */
export function ensureStandardsBlankDocument(_doc: Document): void {
  /* reserved for CSS1Compat srcdoc boot */
}
