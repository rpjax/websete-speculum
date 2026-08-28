/**
 * PROP_SET propId table — frame-protocol.md §4.4 (shipped ISA lacre).
 * Only VALUE / CHECKED / SELECTED. Any other propId is malformed on the wire.
 */

export const PROP_ID_VALUE = 0x01;
export const PROP_ID_CHECKED = 0x02;
export const PROP_ID_SELECTED = 0x03;

export type PropScalar = string | boolean | number;
export type PropValueKind = 'str' | 'bool' | 'f32';

export function propValueKind(propId: number): PropValueKind | null {
  switch (propId) {
    case PROP_ID_VALUE:
      return 'str';
    case PROP_ID_CHECKED:
    case PROP_ID_SELECTED:
      return 'bool';
    default:
      return null;
  }
}

export function propScalarsEqual(a: PropScalar | undefined, b: PropScalar): boolean {
  return a === b;
}
