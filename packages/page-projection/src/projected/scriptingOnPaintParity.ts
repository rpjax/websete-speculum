/**
 * Projected surface runs `sandbox` without `allow-scripts` (K5 — no page JS). With scripting off,
 * HTML renders `<noscript>` fallbacks; Virtual has scripting on and hides them. This emulates
 * Chromium UA paint when scripting is enabled — DOM/table stream unchanged.
 *
 * Prefer Constructable Stylesheets on `adoptedStyleSheets`. If `defaultView` is missing (seen on
 * some mobile browsers while the iframe document is empty mid-EPOCH_RESET) or adopt fails, fall
 * back to a Speculum-owned `<style>` in `<head>` — same paint rule, still not in the producer table.
 */

export const SCRIPTING_ON_PAINT_PARITY_CSS = 'noscript{display:none!important}';

export const PARITY_STYLE_ATTR = 'data-speculum-scripting-on-paint-parity';

const parityByDocument = new WeakMap<Document, CSSStyleSheet>();

export function paritySheetForDocument(doc: Document): CSSStyleSheet | undefined {
  return parityByDocument.get(doc);
}

export function hasParityStyleElement(doc: Document): boolean {
  return doc.querySelector(`style[${PARITY_STYLE_ATTR}]`) != null;
}

/** True when either constructable sheet or fallback `<style>` is live on `doc`. */
export function paintParityInstalled(doc: Document): boolean {
  const sheet = parityByDocument.get(doc);
  if (sheet !== undefined) {
    try {
      if (Array.from(doc.adoptedStyleSheets).includes(sheet)) return true;
    } catch {
      /* fall through */
    }
  }
  return hasParityStyleElement(doc);
}

/**
 * Ensures paint parity is installed. Safe to call on an empty document (no-op until `<head>` /
 * `defaultView` exists) and again after the tree is rebuilt.
 */
export function installScriptingOnPaintParity(doc: Document): void {
  if (installConstructableParity(doc)) return;
  installParityStyleElement(doc);
}

function installConstructableParity(doc: Document): boolean {
  const existing = parityByDocument.get(doc);
  if (existing !== undefined) {
    try {
      const list = Array.from(doc.adoptedStyleSheets);
      if (!list.includes(existing)) {
        doc.adoptedStyleSheets = [existing, ...list.filter((s) => s !== existing)];
      }
      return true;
    } catch {
      parityByDocument.delete(doc);
    }
  }

  const view = doc.defaultView;
  if (view === null || typeof view.CSSStyleSheet !== 'function') return false;

  try {
    const sheet = new view.CSSStyleSheet();
    sheet.replaceSync(SCRIPTING_ON_PAINT_PARITY_CSS);
    const rest = Array.from(doc.adoptedStyleSheets).filter((s) => s !== sheet);
    doc.adoptedStyleSheets = [sheet, ...rest];
    parityByDocument.set(doc, sheet);
    return true;
  } catch {
    return false;
  }
}

function installParityStyleElement(doc: Document): boolean {
  if (hasParityStyleElement(doc)) return true;
  const head = doc.head;
  const host = head ?? doc.documentElement;
  if (host == null) return false;

  const el = doc.createElement('style');
  el.setAttribute(PARITY_STYLE_ATTR, '');
  el.textContent = SCRIPTING_ON_PAINT_PARITY_CSS;
  if (head != null) head.appendChild(el);
  else host.insertBefore(el, host.firstChild);
  return true;
}

/** Producer CSSOM sheets only — parity constructable sheet is client infrastructure, not in the table. */
export function withScriptingOnPaintParity(doc: Document, sheets: CSSStyleSheet[]): CSSStyleSheet[] {
  if (installConstructableParity(doc)) {
    const parity = parityByDocument.get(doc)!;
    return [parity, ...sheets.filter((s) => s !== parity)];
  }
  installParityStyleElement(doc);
  return sheets;
}
