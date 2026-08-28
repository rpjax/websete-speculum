"use strict";
/**
 * Marker embedded in every CDP projection inject bundle.
 * Virtual bootstrap and the bundle prelude scrub tags whose text contains this marker.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.INJECT_SENTINEL_COMMENT = exports.INJECT_SENTINEL_MARKER = void 0;
exports.buildScrubPreludeJs = buildScrubPreludeJs;
exports.INJECT_SENTINEL_MARKER = '__SPECULUM_PP_INJECT_V1__';
exports.INJECT_SENTINEL_COMMENT = `/*${exports.INJECT_SENTINEL_MARKER}*/`;
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