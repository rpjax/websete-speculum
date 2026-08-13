/**
 * Accumulator for DOM-side mutation marks (E-06 / §5.3.2–3).
 * Active / Frozen double-buffer — observers write Active only.
 */

import {
  NONE_DOM_NODE_KEY,
  type DomNodeKey,
} from '../../models/domNodeKey';
import {
  clearDirtySets,
  createDirtySets,
  dirtySetsHaveWork,
  type DirtySets,
  type ScrollSample,
} from '../models/dirtySets';

export type { DirtySets, ScrollSample };
export { VIEWPORT_SCROLL_KEY } from '../models/dirtySets';

export class DomMutationAccumulator {
  private active = createDirtySets();
  private frozen = createDirtySets();

  getActive(): DirtySets {
    return this.active;
  }

  getFrozen(): DirtySets {
    return this.frozen;
  }

  hasActiveWork(): boolean {
    return dirtySetsHaveWork(this.active);
  }

  hasFrozenWork(): boolean {
    return dirtySetsHaveWork(this.frozen);
  }

  swap(): DirtySets {
    const previousActive = this.active;
    this.active = this.frozen;
    clearDirtySets(this.active);
    this.frozen = previousActive;
    return this.frozen;
  }

  clearFrozen(): void {
    clearDirtySets(this.frozen);
  }

  reclaimFrozen(): void {
    const from = this.frozen;
    const to = this.active;
    for (const key of from.newKeys) to.newKeys.add(key);
    for (const key of from.dirtyParents) to.dirtyParents.add(key);
    for (const key of from.attrDirty) to.attrDirty.add(key);
    for (const key of from.textDirty) to.textDirty.add(key);
    for (const key of from.stateDirty) to.stateDirty.add(key);
    for (const key of from.detached) to.detached.add(key);
    for (const [key, sample] of from.scrollDirty) to.scrollDirty.set(key, sample);
    clearDirtySets(this.frozen);
  }

  markNew(key: DomNodeKey): void {
    if (key === NONE_DOM_NODE_KEY) return;
    this.active.newKeys.add(key);
  }

  markDirtyParent(key: DomNodeKey): void {
    if (key === NONE_DOM_NODE_KEY) return;
    this.active.dirtyParents.add(key);
  }

  markAttr(key: DomNodeKey): void {
    if (key === NONE_DOM_NODE_KEY) return;
    this.active.attrDirty.add(key);
  }

  markText(key: DomNodeKey): void {
    if (key === NONE_DOM_NODE_KEY) return;
    this.active.textDirty.add(key);
  }

  markState(key: DomNodeKey): void {
    if (key === NONE_DOM_NODE_KEY) return;
    this.active.stateDirty.add(key);
  }

  markDetached(key: DomNodeKey): void {
    if (key === NONE_DOM_NODE_KEY) return;
    this.active.detached.add(key);
  }

  markScroll(key: DomNodeKey, sample: ScrollSample): void {
    this.active.scrollDirty.set(key, sample);
  }
}
