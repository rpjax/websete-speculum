"use strict";
/**
 * DAG action scheduler — multiple queues, dependsOn, awaits.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBlueprintSchedule = runBlueprintSchedule;
const validate_1 = require("./validate");
async function runBlueprintSchedule(bp, hooks) {
    const validated = (0, validate_1.validateBlueprint)(bp);
    if (!validated.ok) {
        return { ok: false, states: new Map(), validateError: validated.reason };
    }
    const actions = validated.actions;
    const states = new Map();
    for (const [id, a] of actions) {
        states.set(id, { action: a, queue: a.queue, status: 'pending' });
    }
    const terminal = new Set();
    const succeeded = new Set();
    const failed = new Set();
    const skipped = new Set();
    const mark = (id, status, detail) => {
        const st = states.get(id);
        st.status = status;
        st.detail = detail;
        terminal.add(id);
        if (status === 'succeeded')
            succeeded.add(id);
        else if (status === 'failed')
            failed.add(id);
        else
            skipped.add(id);
        hooks.onProgress?.({ actionId: id, queue: st.queue, status, detail });
    };
    const ready = () => {
        const out = [];
        for (const [id, a] of actions) {
            if (terminal.has(id) || states.get(id).status === 'running')
                continue;
            const deps = a.dependsOn ?? [];
            const awaits = a.awaits ?? [];
            if (deps.some((d) => !succeeded.has(d))) {
                if (deps.some((d) => failed.has(d) || skipped.has(d))) {
                    // dependency failed → skip unless we already decided
                    if (!terminal.has(id))
                        mark(id, 'skipped', `dependency failed/skipped`);
                }
                continue;
            }
            if (awaits.some((d) => !terminal.has(d)))
                continue;
            // queue FIFO: previous in same queue must be terminal
            const sameQueue = [...actions.values()].filter((x) => x.queue === a.queue);
            const idx = sameQueue.findIndex((x) => x.id === id);
            if (idx > 0) {
                const prev = sameQueue[idx - 1];
                if (!terminal.has(prev.id))
                    continue;
                if (states.get(prev.id).status === 'failed' && prev.continueOnFail !== true) {
                    if (!terminal.has(id))
                        mark(id, 'skipped', `queue predecessor ${prev.id} failed`);
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
                if (st.status === 'pending')
                    mark(id, 'skipped', 'unsatisfiable schedule');
            }
            break;
        }
        await Promise.all(ids.map(async (id) => {
            const a = actions.get(id);
            const st = states.get(id);
            st.status = 'running';
            hooks.onProgress?.({ actionId: id, queue: a.queue, status: 'started' });
            try {
                const r = await hooks.runAction(a, a.queue);
                mark(id, r.ok ? 'succeeded' : 'failed', r.detail);
            }
            catch (err) {
                mark(id, 'failed', err instanceof Error ? err.message : String(err));
            }
        }));
    }
    const ok = [...states.values()].every((s) => s.status !== 'failed');
    return { ok, states };
}
//# sourceMappingURL=schedule.js.map