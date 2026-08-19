/**
 * CSSOM plane sheet membership — C6 no double-emit.
 * Author `<style>`/`<link>` (`ownerNode`) paint via the projected DOM element.
 * Constructed sheets on `adoptedStyleSheets` without an ownerNode stay on the CSSOM plane.
 * Admitted open shadow roots are the same instance's poll ([shadow.md](shadow.md)).
 */

import { collectAdmittedShadowRoots } from '../dom/shadowAdmit';

export type CssomListedSheet = {
  sheet: CSSStyleSheet;
  /** 0 = document; otherwise the host ELEMENT id. */
  hostNode: number;
};

function pushAdopted(out: CssomListedSheet[], adopted: CSSStyleSheet[] | null | undefined, hostNode: number): void {
  if (!adopted) return;
  for (let i = 0; i < adopted.length; i++) {
    const s = adopted[i];
    if (!s || s.ownerNode) continue;
    out.push({ sheet: s, hostNode });
  }
}

/** Sheets the CSSOM poll / O2 walk may stamp and emit. */
export function collectCssomPlaneSheets(
  doc: Document,
  hostIdOf?: (host: Element) => number,
): CssomListedSheet[] {
  const out: CssomListedSheet[] = [];
  pushAdopted(out, doc.adoptedStyleSheets as unknown as CSSStyleSheet[], 0);
  if (hostIdOf === undefined) return out;
  const roots = collectAdmittedShadowRoots(doc);
  for (let i = 0; i < roots.length; i++) {
    const sr = roots[i]!;
    const hostId = hostIdOf(sr.host);
    if (!hostId) continue;
    pushAdopted(out, sr.adoptedStyleSheets as unknown as CSSStyleSheet[], hostId);
  }
  return out;
}
