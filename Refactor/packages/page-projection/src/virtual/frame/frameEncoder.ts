/**
 * Logical Frame → wire bytes port (§5.5).
 * Impls in this folder: {@link BinaryFrameEncoder}, …
 *
 * Returns one or more parts (same generation/sequence; differing partIndex).
 */

import type { Frame } from '../../models/frame';

export type FrameEncoder = {
  encode(frame: Frame): Uint8Array[];
  readonly maxFrameBytes?: number;
};
