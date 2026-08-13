/**
 * Scroll sensors — last sample wins in scrollDirty (mark only).
 */

import type { DomMutationAccumulator } from './domMutationAccumulator';
import { VIEWPORT_SCROLL_KEY } from '../models/dirtySets';
import { NONE_DOM_NODE_KEY, type DomNodeTable } from './domNodeTable';

export type ScrollSensorsOptions = {
  domNodes: DomNodeTable;
  accumulator: DomMutationAccumulator;
};

export function attachScrollSensors(opts: ScrollSensorsOptions): () => void {
  const onScroll = (ev: Event) => {
    const target = ev.target;
    if (target === document || target === document.documentElement || target === document.body) {
      opts.accumulator.markScroll(VIEWPORT_SCROLL_KEY, {
        x: window.scrollX,
        y: window.scrollY,
      });
      return;
    }
    if (!(target instanceof Element)) return;
    const key = opts.domNodes.keyOf(target);
    if (key === NONE_DOM_NODE_KEY) return;
    const el = target as HTMLElement;
    opts.accumulator.markScroll(key, { x: el.scrollLeft, y: el.scrollTop });
  };

  window.addEventListener('scroll', onScroll, true);
  return () => window.removeEventListener('scroll', onScroll, true);
}
