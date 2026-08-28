/**
 * DAG action scheduler — multiple queues, dependsOn, awaits.
 */

import type { LabAction, LabBlueprint, ActionRuntimeState, ActionTerminalStatus } from './types';
import { validateBlueprint } from './validate';

export type ScheduleHooks = {
  runAction: (action: LabAction, queue: string) => Promise<{ ok: boolean; detail?: string }>;
  onProgress?: (p: {
    actionId: string;
    queue: string;
    status: 'started' | ActionTerminalStatus;
    detail?: string;
  }) => void;
};

export type ScheduleResult = {
  ok: boolean;
  states: Map<string, ActionRuntimeState>;
  validateError?: string;
};

export async function runBlueprintSchedule(
  bp: LabBlueprint,
  hooks: ScheduleHooks,
): Promise<ScheduleResult> {
  const validated = validateBlueprint(bp);
  if (!validated.ok) {
    return { ok: false, states: new Map(), validateError: validated.reason };
  }
  const actions = validated.actions;
  const states = new Map<string, ActionRuntimeState>();
  for (const [id, a] of actions) {
    states.set(id, { action: a, queue: a.queue, status: 'pending' });
  }

  const terminal = new Set<string>();
  const succeeded = new Set<string>();
  const failed = new Set<string>();
  const skipped = new Set<string>();

  const mark = (id: string, status: ActionTerminalStatus, detail?: string) => {
    const st = states.get(id)!;
    st.status = status;
    st.detail = detail;
    terminal.add(id);
    if (status === 'succeeded') succeeded.add(id);
    else if (status === 'failed') failed.add(id);
    else skipped.add(id);
    hooks.onProgress?.({ actionId: id, queue: st.queue, status, detail });
  };

  const ready = (): string[] => {
    const out: string[] = [];
    for (const [id, a] of actions) {
      if (terminal.has(id) || states.get(id)!.status === 'running') continue;
      const deps = a.dependsOn ?? [];
      const awaits = a.awaits ?? [];
      if (deps.some((d) => !succeeded.has(d))) {
        if (deps.some((d) => failed.has(d) || skipped.has(d))) {
          // dependency failed → skip unless we already decided
          if (!terminal.has(id)) mark(id, 'skipped', `dependency failed/skipped`);
        }
        continue;
      }
      if (awaits.some((d) => !terminal.has(d))) continue;
      // queue FIFO: previous in same queue must be terminal
      const sameQueue = [...actions.values()].filter((x) => x.queue === a.queue);
      const idx = sameQueue.findIndex((x) => x.id === id);
      if (idx > 0) {
        const prev = sameQueue[idx - 1]!;
        if (!terminal.has(prev.id)) continue;
        if (states.get(prev.id)!.status === 'failed' && prev.continueOnFail !== true) {
          if (!terminal.has(id)) mark(id, 'skipped', `queue predecessor ${prev.id} failed`);
          continue;
        }
      }
      out.push(id);
    }
    return out;
  };

  while (terminal.size < actions.size) {
    const ids = ready();
    if (ids.length === 0) {
      // deadlock or all remaining unsatisfiable
      for (const [id, st] of states) {
        if (st.status === 'pending') mark(id, 'skipped', 'unsatisfiable schedule');
      }
      break;
    }
    await Promise.all(
      ids.map(async (id) => {
        const a = actions.get(id)!;
        const st = states.get(id)!;
        st.status = 'running';
        hooks.onProgress?.({ actionId: id, queue: a.queue, status: 'started' });
        try {
          const r = await hooks.runAction(a, a.queue);
          mark(id, r.ok ? 'succeeded' : 'failed', r.detail);
        } catch (err) {
          mark(id, 'failed', err instanceof Error ? err.message : String(err));
        }
      }),
    );
  }

  const ok = [...states.values()].every((s) => s.status !== 'failed');
  return { ok, states };
}
