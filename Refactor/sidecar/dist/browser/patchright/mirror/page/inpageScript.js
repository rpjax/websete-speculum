"use strict";
/**
 * In-page producer bootstrap for the redesigned PageProjection engine (§5.1–5.3).
 * Injected into Virtual Chromium; identity is off-DOM (WeakMap) — never writes
 * speculum-anchor / speculum-last-mutation-sequence into the site's DOM (PP-ID-1).
 *
 * Live cutover: PatchrightBrowserSession installs this alongside (then instead of)
 * PAGE_PROJECTION_PAGE_SCRIPT once binary channel wiring is complete.
 *
 * Sensor coverage (§5.1–5.3, §5.10):
 * - Dom: MutationObserver + the §5.2.1 state-sensor event list, armed on the
 *   main document, every shadow root (open, or closed via the patched
 *   `attachShadow`) and every same-origin iframe's `contentDocument`.
 * - Cssom: prototype hooks on `CSSStyleSheet`/`CSSStyleDeclaration` plus
 *   `adoptedStyleSheets` setter interception and `<style>`/`<link>` lifecycle
 *   tracking, sharing the Dom uint32 id space via the same `allocate()`.
 * - Shadow DOM is published flattened (PP-F-3): a host's F children are the
 *   shadow root's rendered content with `<slot>` replaced by its assigned
 *   nodes (or its default content when nothing is slotted).
 *
 * Known realm boundary (not a W4 item): `page.addInitScript` re-runs this
 * whole bootstrap inside every same-origin iframe's own realm too, so the
 * Cssom prototype hooks above are patched on *that* realm's own
 * `CSSStyleSheet.prototype` etc., not this (top) realm's. Structural DOM
 * (MutationObserver), scroll and the state-sensor events reach into a pierced
 * iframe fine — those are plain DOM API calls, unaffected by realm — and are
 * armed by `bindIframeInterior` below. Style/link *elements* inside a pierced
 * iframe are also covered (their lifecycle rides the same MutationObserver).
 * What is NOT covered: a script running inside that iframe calling a Cssom
 * API (`sheet.insertRule(...)`, `shadowRoot.adoptedStyleSheets = [...]`, a
 * rule's `style.setProperty(...)`) directly — that resolves against the
 * iframe's own prototypes, which this top-realm patch never touches. Cross-
 * origin iframes and closed shadow roots created before this script installs
 * remain W4 (need a shared CDP session).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAGE_PROJECTION_V2_PAGE_SCRIPT = void 0;
const inpageScriptCore_1 = require("./inpageScriptCore");
const inpageScriptCssom_1 = require("./inpageScriptCssom");
const inpageScriptObserve_1 = require("./inpageScriptObserve");
/** Concatenated in-page IIFE — fragments only; algorithm unchanged. */
exports.PAGE_PROJECTION_V2_PAGE_SCRIPT = inpageScriptCore_1.INPAGE_SCRIPT_V2_CORE + inpageScriptCssom_1.INPAGE_SCRIPT_V2_CSSOM + inpageScriptObserve_1.INPAGE_SCRIPT_V2_OBSERVE;
//# sourceMappingURL=inpageScript.js.map