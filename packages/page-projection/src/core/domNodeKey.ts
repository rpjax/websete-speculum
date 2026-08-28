/**
 * Shared projection models — pure data, no DOM / no Node APIs.
 * Imported by inpage (bundled), host, and later the web client decode path.
 */

/** Wire/address key for a DOM node row. `0` means none. */
export type DomNodeKey = number;

/** Reserved: no row. Never allocated. */
export const NONE_DOM_NODE_KEY: DomNodeKey = 0;
