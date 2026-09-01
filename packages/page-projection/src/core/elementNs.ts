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

/**
 * `NODE_NEW` ELEMENT `ns` byte: low nibble is {@link ElementNs}.
 * Bit 7 set ⇒ `childScopeId: u32` follows the attribute list (nested-context host).
 * Bits 4–6 reserved 0. Same omit pattern as `ns === custom` → uri StrRef.
 */
export const ELEMENT_NS_NESTED_HOST_BIT = 0x80;
export const ELEMENT_NS_RESERVED_BITS = 0x70;

export function packElementNsWireByte(ns: ElementNs, nestedHost: boolean): number {
  if (ns > ElementNs.Custom) {
    throw new Error(`NODE_NEW ns ${ns} out of range (frame-protocol.md §4.2)`);
  }
  return (nestedHost ? ELEMENT_NS_NESTED_HOST_BIT : 0) | ns;
}

export function unpackElementNsWireByte(byte: number): { ns: ElementNs; nestedHost: boolean } {
  if ((byte & ELEMENT_NS_RESERVED_BITS) !== 0) {
    throw new Error(`NODE_NEW ns reserved bits 0x${(byte & ELEMENT_NS_RESERVED_BITS).toString(16)} (frame-protocol.md §4.2)`);
  }
  const ns = byte & 0x0f;
  if (ns > ElementNs.Custom) {
    throw new Error(`NODE_NEW ns ${ns} out of range (frame-protocol.md §4.2)`);
  }
  return { ns: ns as ElementNs, nestedHost: (byte & ELEMENT_NS_NESTED_HOST_BIT) !== 0 };
}

/** Nested `contextId` is never `0` (none) or `1` (session root). */
export function assertNestedChildScopeId(id: number): void {
  if (!Number.isInteger(id) || id < 2 || id > 0xffffffff) {
    throw new Error(`NODE_NEW childScopeId ${id} is not a nested context (frame-protocol.md §4.2)`);
  }
}

/** Producer: omit both, or set a nested id (≥2). `nestedHost: false` with an id is malformed. */
export function resolveElementNestedHost(op: {
  nestedHost?: boolean;
  childScopeId?: number | null;
}): { nestedHost: false; childScopeId: null } | { nestedHost: true; childScopeId: number } {
  const id = op.childScopeId ?? null;
  if (op.nestedHost === false && id != null) {
    throw new Error('NODE_NEW nestedHost=false with childScopeId (frame-protocol.md §4.2)');
  }
  if (op.nestedHost !== true && id == null) return { nestedHost: false, childScopeId: null };
  if (id == null) {
    throw new Error('NODE_NEW nestedHost without childScopeId (frame-protocol.md §4.2)');
  }
  assertNestedChildScopeId(id);
  return { nestedHost: true, childScopeId: id };
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
