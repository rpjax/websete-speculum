/**
 * Imperative state sensors (§5.2.1) — mark stateDirty only.
 */

import type { DomMutationAccumulator } from './domMutationAccumulator';
import { NONE_DOM_NODE_KEY, type DomNodeTable } from './domNodeTable';

export type StateSensorsOptions = {
  domNodes: DomNodeTable;
  accumulator: DomMutationAccumulator;
  root?: ParentNode;
};

export function attachStateSensors(opts: StateSensorsOptions): () => void {
  const root = opts.root ?? document;
  const mark = (target: EventTarget | null) => {
    if (!(target instanceof Node)) return;
    const key = opts.domNodes.keyOf(target);
    if (key === NONE_DOM_NODE_KEY) return;
    opts.accumulator.markState(key);
  };

  const onInput = (ev: Event) => mark(ev.target);
  const onChange = (ev: Event) => mark(ev.target);
  const onToggle = (ev: Event) => mark(ev.target);
  const onClose = (ev: Event) => mark(ev.target);

  root.addEventListener('input', onInput, true);
  root.addEventListener('change', onChange, true);
  root.addEventListener('toggle', onToggle, true);
  root.addEventListener('close', onClose, true);

  return () => {
    root.removeEventListener('input', onInput, true);
    root.removeEventListener('change', onChange, true);
    root.removeEventListener('toggle', onToggle, true);
    root.removeEventListener('close', onClose, true);
  };
}
