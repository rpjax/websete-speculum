/**
 * NODE_NEW Element namespace — frame-protocol.md §1.3 / §4.2.
 * Known values are a u8 on the wire; `custom` is the only case that carries a StrRef.
 */

export enum ElementNs {
  Html = 0,
  Svg = 1,
  Mathml = 2,
  None = 3,
  Custom = 4,
}

export const ELEMENT_NS_HTML = 'http://www.w3.org/1999/xhtml';
export const ELEMENT_NS_SVG = 'http://www.w3.org/2000/svg';
export const ELEMENT_NS_MATHML = 'http://www.w3.org/1998/Math/MathML';

/** Producer: live `element.namespaceURI` → wire enum (+ uri only for custom). */
export function classifyElementNs(namespaceURI: string | null): { ns: ElementNs; uri?: string } {
  if (namespaceURI === null) return { ns: ElementNs.None };
  if (namespaceURI === ELEMENT_NS_HTML) return { ns: ElementNs.Html };
  if (namespaceURI === ELEMENT_NS_SVG) return { ns: ElementNs.Svg };
  if (namespaceURI === ELEMENT_NS_MATHML) return { ns: ElementNs.Mathml };
  return { ns: ElementNs.Custom, uri: namespaceURI };
}

/** Client: wire enum → `createElementNS` first argument. */
export function elementNsUri(ns: ElementNs, customUri?: string): string | null {
  switch (ns) {
    case ElementNs.Html:
      return ELEMENT_NS_HTML;
    case ElementNs.Svg:
      return ELEMENT_NS_SVG;
    case ElementNs.Mathml:
      return ELEMENT_NS_MATHML;
    case ElementNs.None:
      return null;
    case ElementNs.Custom:
      return customUri ?? '';
  }
}

/** Snapshot / iso label: omit html; `svg` / `mathml` / `none` / custom URI otherwise. */
export function elementNsSnapshotLabel(namespaceURI: string | null): string | undefined {
  const { ns, uri } = classifyElementNs(namespaceURI);
  switch (ns) {
    case ElementNs.Html:
      return undefined;
    case ElementNs.Svg:
      return 'svg';
    case ElementNs.Mathml:
      return 'mathml';
    case ElementNs.None:
      return 'none';
    case ElementNs.Custom:
      return uri;
  }
}
