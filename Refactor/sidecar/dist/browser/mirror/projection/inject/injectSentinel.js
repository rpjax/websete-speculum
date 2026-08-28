"use strict";
/**
 * Marker embedded in every CDP projection inject bundle.
 * Virtual bootstrap and the bundle prelude scrub tags whose text contains this marker.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.INJECT_ARM_GLOBAL = exports.INJECT_SENTINEL_COMMENT = exports.INJECT_SENTINEL_MARKER = void 0;
exports.buildInjectRuntimePresentExpression = buildInjectRuntimePresentExpression;
exports.wrapInjectWithArm = wrapInjectWithArm;
exports.buildInjectArmJs = buildInjectArmJs;
exports.buildScrubPreludeJs = buildScrubPreludeJs;
exports.INJECT_SENTINEL_MARKER = '__SPECULUM_PP_INJECT_V1__';
exports.INJECT_SENTINEL_COMMENT = `/*${exports.INJECT_SENTINEL_MARKER}*/`;
/**
 * Sync per-document arm — first line of the inject source after the sentinel.
 * Same main-world evaluate is single-threaded: onNewDocument and lateBoot cannot
 * both pass this gate. Prevents double prelude / double Virtual on one heap.
 */
exports.INJECT_ARM_GLOBAL = '__SPECULUM_PP_INJECT_ARMED__';
/** Tiny main-world presence probe (product lateBoot). Includes arm so mid-inject skips. */
function buildInjectRuntimePresentExpression() {
    return (`!!(globalThis.__speculumProjection||globalThis.__speculumProjectionBoot||` +
        `globalThis.${exports.INJECT_ARM_GLOBAL})`);
}
/**
 * Wrap inject body so re-evaluate on the same document is a no-op.
 * Must be a function: top-level `return` is illegal in CDP Runtime.evaluate scripts.
 */
function wrapInjectWithArm(generation, body) {
    const g = Number.isFinite(generation) && generation > 0 ? Math.floor(generation) : 1;
    return (`(function speculum_pp_inject_once(){\n'use strict';\n` +
        `if(globalThis.${exports.INJECT_ARM_GLOBAL}===${g})return;\n` +
        `globalThis.${exports.INJECT_ARM_GLOBAL}=${g};\n` +
        `${body}\n` +
        `})();`);
}
/** @deprecated use wrapInjectWithArm — kept name for call-site clarity in tests */
function buildInjectArmJs(generation) {
    const g = Number.isFinite(generation) && generation > 0 ? Math.floor(generation) : 1;
    return (`if(globalThis.${exports.INJECT_ARM_GLOBAL}===${g})return;` +
        `globalThis.${exports.INJECT_ARM_GLOBAL}=${g};`);
}
/** JS prelude: remove prior inject script tags (not the currently executing script). */
function buildScrubPreludeJs() {
    return `
function __speculumScrubInjectScripts() {
  var cur = document.currentScript;
  var marker = '${exports.INJECT_SENTINEL_MARKER}';
  var list = document.querySelectorAll('script');
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (s === cur) continue;
    if (!s.src && s.textContent && s.textContent.indexOf(marker) >= 0) s.remove();
  }
}
__speculumScrubInjectScripts();
`;
}
//# sourceMappingURL=injectSentinel.js.map