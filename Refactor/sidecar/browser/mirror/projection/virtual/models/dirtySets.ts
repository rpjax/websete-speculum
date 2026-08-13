/**
 * Per-frame DOM dirty mark sets (parent §5.3.2) — pure data, no DOM.
 */

import { NONE_DOM_NODE_KEY, type DomNodeKey } from '../../models/domNodeKey';

export type ScrollSample = { x: number; y: number };

/** Sentinel scrollDirty key for the document viewport. */
export const VIEWPORT_SCROLL_KEY: DomNodeKey = NONE_DOM_NODE_KEY;

export type DirtySets = {
  newKeys: Set<DomNodeKey>;
  dirtyParents: Set<DomNodeKey>;
  attrDirty: Set<DomNodeKey>;
  textDirty: Set<DomNodeKey>;
  stateDirty: Set<DomNodeKey>;
  scrollDirty: Map<DomNodeKey, ScrollSample>;
  detached: Set<DomNodeKey>;
};

export function createDirtySets(): DirtySets {
  return {
    newKeys: new Set(),
    dirtyParents: new Set(),
    attrDirty: new Set(),
    textDirty: new Set(),
    stateDirty: new Set(),
    scrollDirty: new Map(),
    detached: new Set(),
  };
}

export function clearDirtySets(sets: DirtySets): void {
  sets.newKeys.clear();
  sets.dirtyParents.clear();
  sets.attrDirty.clear();
  sets.textDirty.clear();
  sets.stateDirty.clear();
  sets.scrollDirty.clear();
  sets.detached.clear();
}

export function dirtyCard(sets: DirtySets): {
  newKeys: number;
  dirtyParents: number;
  attrDirty: number;
  textDirty: number;
  stateDirty: number;
  scrollDirty: number;
  detached: number;
} {
  return {
    newKeys: sets.newKeys.size,
    dirtyParents: sets.dirtyParents.size,
    attrDirty: sets.attrDirty.size,
    textDirty: sets.textDirty.size,
    stateDirty: sets.stateDirty.size,
    scrollDirty: sets.scrollDirty.size,
    detached: sets.detached.size,
  };
}

export function dirtySetsHaveWork(sets: DirtySets): boolean {
  return (
    sets.newKeys.size > 0 ||
    sets.dirtyParents.size > 0 ||
    sets.attrDirty.size > 0 ||
    sets.textDirty.size > 0 ||
    sets.stateDirty.size > 0 ||
    sets.scrollDirty.size > 0 ||
    sets.detached.size > 0
  );
}
