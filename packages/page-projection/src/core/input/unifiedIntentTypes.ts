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
  x: number;
  y: number;
  button?: 'left' | 'middle' | 'right';
  /**
   * Client-side hit-test for `down`/`up`: context/node in the Projected replica plus
   * root-viewport pointer coords. Virtual validates the point lies inside the live node
   * bounds and dispatches CDP there (not element center).
   */
  contextId?: number;
  nodeId?: number | null;
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
