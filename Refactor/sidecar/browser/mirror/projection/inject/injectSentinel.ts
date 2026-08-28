/**
 * Marker embedded in every CDP projection inject bundle.
 * Virtual bootstrap and the bundle prelude scrub tags whose text contains this marker.
 */

export const INJECT_SENTINEL_MARKER = '__SPECULUM_PP_INJECT_V1__';

export const INJECT_SENTINEL_COMMENT = `/*${INJECT_SENTINEL_MARKER}*/`;

/** JS prelude: remove prior inject script tags (not the currently executing script). */
export function buildScrubPreludeJs(): string {
  return `
function __speculumScrubInjectScripts() {
  var cur = document.currentScript;
  var marker = '${INJECT_SENTINEL_MARKER}';
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
