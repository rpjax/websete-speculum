/**
 * CSSOM plane sheet membership — C6 no double-emit.
 * Author `<style>`/`<link>` (`ownerNode`) paint via the projected DOM element.
 * Constructed sheets on `adoptedStyleSheets` without an ownerNode stay on the CSSOM plane.
 */

/** Sheets the CSSOM poll / O2 walk may stamp and emit. */
export function collectCssomPlaneSheets(doc: Document): CSSStyleSheet[] {
  const out: CSSStyleSheet[] = [];
  const adopted = doc.adoptedStyleSheets;
  if (!adopted) return out;
  for (let i = 0; i < adopted.length; i++) {
    const s = adopted[i];
    if (!s || s.ownerNode) continue;
    out.push(s);
  }
  return out;
}
