/**
 * Unified input intent envelope v1 (§10.6) — sparse-cdp / id-addressed path only.
 * OS census (`ScrollCensus` on down/up) was removed with the PP OS stack
 * (decision-log.md 2026-08-27).
 */

export const UNIFIED_INTENT_SCHEMA_VERSION = 1 as const;

export type UnifiedIntentType =
  | 'move'
  | 'down'
  | 'up'
  | 'keyDown'
  | 'keyUp'
  | 'scrollSet'
  | 'setFiles'
  | 'historyNav';

/** Single-context scroll position (used by `scrollSet` / Virtual applyScrollPositions). */
export type ScrollPositionEntry = {
  nodeId: number | null;
  scrollX: number;
  scrollY: number;
};

export type UnifiedIntentBase = {
  schemaVersion: typeof UNIFIED_INTENT_SCHEMA_VERSION;
  type: UnifiedIntentType;
  traceId?: string;
  timestampClient?: number;
};

export type PointerIntent = UnifiedIntentBase & {
  type: 'move' | 'down' | 'up';
  viewportW: number;
  viewportH: number;
  /** Root-viewport CSS stamp (journal / move). Not the sparse-cdp hit criterion for down/up. */
  x: number;
  y: number;
  button?: 'left' | 'middle' | 'right';
  /**
   * `down`/`up` hit: Projected `event.target` → `nodeId`, plus position inside that
   * element's border box as fractions of width/height (top-left origin, [0,1]).
   * Virtual maps local → live root-viewport CSS for CDP (survives Projected≠Virtual layout).
   * Omit local → Virtual center (lab helpers).
   */
  contextId?: number;
  nodeId?: number | null;
  localX?: number;
  localY?: number;
};

export type KeyIntent = UnifiedIntentBase & {
  type: 'keyDown' | 'keyUp';
  key: string;
  code: string;
  modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean };
};

export type ScrollSetIntent = UnifiedIntentBase & {
  type: 'scrollSet';
  contextId: number;
  nodeId: number | null;
  scrollX: number;
  scrollY: number;
};

export type SetFilesIntent = UnifiedIntentBase & {
  type: 'setFiles';
  contextId: number;
  nodeId: number;
  files: unknown;
};

export type HistoryNavIntent = UnifiedIntentBase & {
  type: 'historyNav';
  direction: 'back' | 'forward';
};

export type UnifiedIntent =
  | PointerIntent
  | KeyIntent
  | ScrollSetIntent
  | SetFilesIntent
  | HistoryNavIntent;
