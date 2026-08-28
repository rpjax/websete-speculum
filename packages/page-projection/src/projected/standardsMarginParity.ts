/**
 * Quirks (`BackCompat`) vs standards (`CSS1Compat`) UA margin collapse differs for
 * `body` + first heading — ~13px vertical drift, enough to miss a 21px input under OS ABS.
 *
 * Full fix is booting projected iframes in CSS1Compat (srcdoc + load; K4 / frame-protocol §1.2).
 * Until that async surface path lands, zero `body` margin-top so first-child block margins
 * match the standards collapse `max(body, child)` for the common UA defaults.
 */

export const STANDARDS_MARGIN_PARITY_CSS = [
  'body{margin-top:0!important}',
  /* Quirks collapses first-heading margin-top through body; standards keeps ~0.67*2em. */
  'body:has(> :is(h1,h2,h3,h4,h5,h6):first-child){padding-top:1.34em!important}',
  'body:has(> :is(h1,h2,h3,h4,h5,h6):first-child)>:is(h1,h2,h3,h4,h5,h6):first-child{margin-top:0!important}',
].join('');

export const MARGIN_PARITY_ATTR = 'data-speculum-standards-margin-parity';

export function installStandardsMarginParity(doc: Document): void {
  if (doc.compatMode === 'CSS1Compat') return;
  if (doc.querySelector(`style[${MARGIN_PARITY_ATTR}]`)) return;
  const host = doc.head ?? doc.documentElement;
  if (!host) return;
  const el = doc.createElement('style');
  el.setAttribute(MARGIN_PARITY_ATTR, '');
  el.textContent = STANDARDS_MARGIN_PARITY_CSS;
  if (doc.head) doc.head.appendChild(el);
  else host.insertBefore(el, host.firstChild);
}
