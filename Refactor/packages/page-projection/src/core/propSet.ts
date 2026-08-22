/**
 * PROP_SET propId table — frame-protocol.md §4.4.
 * Decoder accepts 0x01–0x0A. Lab emit/materialize is VALUE/CHECKED/SELECTED only.
 */

export const PROP_ID_VALUE = 0x01;
export const PROP_ID_CHECKED = 0x02;
export const PROP_ID_SELECTED = 0x03;
export const PROP_ID_DIALOG_MODAL = 0x04;
export const PROP_ID_POPOVER_OPEN = 0x05;
export const PROP_ID_MEDIA_PAUSED = 0x06;
export const PROP_ID_MEDIA_TIME = 0x07;
export const PROP_ID_MEDIA_MUTED = 0x08;
export const PROP_ID_MEDIA_VOLUME = 0x09;
export const PROP_ID_CUSTOM_VALIDITY = 0x0a;

export type PropScalar = string | boolean | number;
export type PropValueKind = 'str' | 'bool' | 'f32';

export function propValueKind(propId: number): PropValueKind | null {
  switch (propId) {
    case PROP_ID_VALUE:
    case PROP_ID_CUSTOM_VALIDITY:
      return 'str';
    case PROP_ID_CHECKED:
    case PROP_ID_SELECTED:
    case PROP_ID_DIALOG_MODAL:
    case PROP_ID_POPOVER_OPEN:
    case PROP_ID_MEDIA_PAUSED:
    case PROP_ID_MEDIA_MUTED:
      return 'bool';
    case PROP_ID_MEDIA_TIME:
    case PROP_ID_MEDIA_VOLUME:
      return 'f32';
    default:
      return null;
  }
}

export function propScalarsEqual(a: PropScalar | undefined, b: PropScalar): boolean {
  return a === b;
}
