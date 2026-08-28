/**
 * Blueprint graph validation (cycles, ids, snap/iso exclusivity).
 */

import type { LabAction, LabBlueprint } from './types';

export type ValidateResult =
  | { ok: true; actions: Map<string, LabAction & { queue: string }> }
  | { ok: false; reason: string };

const SNAP_KINDS = new Set(['snap', 'iso']);

export function validateBlueprint(bp: LabBlueprint): ValidateResult {
  const actions = new Map<string, LabAction & { queue: string }>();
  for (const q of bp.queues) {
    for (const a of q.actions) {
      if (actions.has(a.id)) return { ok: false, reason: `duplicate action id ${a.id}` };
      actions.set(a.id, { ...a, queue: a.queue ?? q.name });
    }
  }
  if (actions.size === 0) return { ok: false, reason: 'blueprint has no actions' };

  for (const a of actions.values()) {
    for (const dep of a.dependsOn ?? []) {
      if (!actions.has(dep)) return { ok: false, reason: `dependsOn unknown id ${dep} from ${a.id}` };
    }
    for (const dep of a.awaits ?? []) {
      if (!actions.has(dep)) return { ok: false, reason: `awaits unknown id ${dep} from ${a.id}` };
    }
  }

  // Cycle detection on union of dependsOn + awaits edges
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const edges = (id: string): string[] => {
    const a = actions.get(id)!;
    return [...(a.dependsOn ?? []), ...(a.awaits ?? [])];
  };
  const dfs = (id: string): string | null => {
    if (visiting.has(id)) return id;
    if (visited.has(id)) return null;
    visiting.add(id);
    for (const to of edges(id)) {
      const c = dfs(to);
      if (c) return c;
    }
    visiting.delete(id);
    visited.add(id);
    return null;
  };
  for (const id of actions.keys()) {
    const c = dfs(id);
    if (c) return { ok: false, reason: `cycle involving ${c}` };
  }

  // Parallel snap/iso: if two snap/iso actions have no ordering edge between them, reject
  const snapIso = [...actions.values()].filter((a) => SNAP_KINDS.has(a.type));
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === to) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const n of edges(cur)) stack.push(n);
      // also queue order: earlier in same queue precedes later
    }
    return false;
  };
  const queueIndex = new Map<string, number>();
  for (const q of bp.queues) {
    q.actions.forEach((a, i) => queueIndex.set(a.id, i));
  }
  const orderedBefore = (a: string, b: string): boolean => {
    if (reaches(b, a)) return true; // b depends on a ⇒ a before b
    const aa = actions.get(a)!;
    const bb = actions.get(b)!;
    if (aa.queue === bb.queue) {
      return (queueIndex.get(a) ?? 0) < (queueIndex.get(b) ?? 0);
    }
    return false;
  };
  for (let i = 0; i < snapIso.length; i++) {
    for (let j = i + 1; j < snapIso.length; j++) {
      const a = snapIso[i]!.id;
      const b = snapIso[j]!.id;
      if (!orderedBefore(a, b) && !orderedBefore(b, a)) {
        return {
          ok: false,
          reason: `parallel snap/iso without ordering: ${a} and ${b}`,
        };
      }
    }
  }

  return { ok: true, actions };
}
