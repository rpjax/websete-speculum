"use strict";
/**
 * PageProjection input dispatch — A/B/C (input-v2 2026-08-23).
 * A: CDP fire-and-forget. B: Control → Virtual.domNodes. C: setFiles CDP resolve only.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PageProjectionInputDispatch = void 0;
exports.classifyInputMode = classifyInputMode;
const DomElementInput_1 = require("../../../patchright/mirror/dom/DomElementInput");
const frame_1 = require("@speculum/page-projection/core/frame");
const intentTypes_1 = require("@speculum/page-projection/core/input/intentTypes");
const resolveVirtualNode_1 = require("./resolveVirtualNode");
const MODE_B = new Set(['scrollelement', 'focus', 'blur', 'input']);
const LATENCY_SAMPLES = 256;
function emptyMode() {
    return {
        received: 0,
        dispatched: 0,
        dropped: 0,
        dropsByReason: {},
        byType: {},
        dispatchSamples: [],
    };
}
function latencyStats(samples) {
    if (samples.length === 0)
        return { count: 0, min: 0, avg: 0, p95: 0, max: 0 };
    const sorted = [...samples].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const p95Idx = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
    return {
        count: sorted.length,
        min: sorted[0],
        avg: sum / sorted.length,
        p95: sorted[p95Idx],
        max: sorted[sorted.length - 1],
    };
}
function snapshotMode(b) {
    return {
        received: b.received,
        dispatched: b.dispatched,
        dropped: b.dropped,
        dropsByReason: { ...b.dropsByReason },
        byType: Object.fromEntries(Object.entries(b.byType).map(([k, v]) => [k, { ...v }])),
        dispatchMs: latencyStats(b.dispatchSamples),
    };
}
function classifyInputMode(type) {
    const t = type.trim().toLowerCase();
    if (t === 'setfiles')
        return 'C';
    if (MODE_B.has(t))
        return 'B';
    return 'A';
}
class PageProjectionInputDispatch {
    page;
    domInput;
    sendControl;
    resolver;
    ingressReceived = 0;
    ingressDropped = 0;
    ingressDropsByReason = {};
    modes = {
        A: emptyMode(),
        B: emptyMode(),
        C: emptyMode(),
    };
    clientLagSamples = [];
    lastOutcome = null;
    constructor(page, opts) {
        this.page = page;
        this.sendControl = opts?.sendControl ?? null;
        this.resolver = (0, resolveVirtualNode_1.createVirtualTargetResolver)(page);
        this.domInput = new DomElementInput_1.DomElementInput(page, { takeUpload: () => undefined }, {
            resolveTarget: (targetId, contextId) => this.resolver.resolve(targetId, contextId ?? frame_1.CONTEXT_ID_ROOT),
        });
    }
    getPipelineMetrics() {
        return {
            ingressReceived: this.ingressReceived,
            ingressDropped: this.ingressDropped,
            ingressDropsByReason: { ...this.ingressDropsByReason },
            byMode: {
                A: snapshotMode(this.modes.A),
                B: snapshotMode(this.modes.B),
                C: snapshotMode(this.modes.C),
            },
            clientLagMs: latencyStats(this.clientLagSamples),
            inject: this.domInput.getMetrics(),
            lastOutcome: this.lastOutcome,
        };
    }
    async dispatchIntent(intent) {
        const receivedAt = Date.now();
        this.ingressReceived += 1;
        const type = intent.type.trim().toLowerCase();
        const mode = classifyInputMode(type);
        const bucket = this.modes[mode];
        bucket.received += 1;
        let row = bucket.byType[type];
        if (!row) {
            row = { received: 0, dispatched: 0, dropped: 0 };
            bucket.byType[type] = row;
        }
        row.received += 1;
        let clientLagMs;
        if (typeof intent.wallClientMs === 'number' && Number.isFinite(intent.wallClientMs)) {
            const lag = receivedAt - intent.wallClientMs;
            if (lag >= 0 && lag < 60_000) {
                clientLagMs = lag;
                this.clientLagSamples.push(lag);
                if (this.clientLagSamples.length > LATENCY_SAMPLES)
                    this.clientLagSamples.shift();
            }
        }
        const started = Date.now();
        let outcome;
        if (mode === 'B') {
            if (intent.nodeId == null || intent.nodeId <= 0) {
                outcome = { status: 'dropped', reason: 'node_id_required' };
            }
            else if (!this.sendControl) {
                outcome = { status: 'dropped', reason: 'control_unavailable' };
            }
            else {
                this.sendControl({
                    type: 'input',
                    contextId: intent.contextId > 0 ? intent.contextId : frame_1.CONTEXT_ID_ROOT,
                    intentType: type,
                    nodeId: intent.nodeId,
                    payload: intent.payload,
                });
                outcome = { status: 'dispatched' };
            }
        }
        else {
            // Mode A (+ C setFiles): CDP. No nested frame map — client sends root viewport coords.
            outcome = await this.domInput.dispatch({
                type: intent.type,
                targetId: mode === 'C' ? intent.nodeId : null,
                contextId: intent.contextId,
                generation: intent.generation,
                timestampClient: intent.timestampClient,
                payloadJson: intent.payload,
            });
        }
        const dispatchMs = Date.now() - started;
        bucket.dispatchSamples.push(dispatchMs);
        if (bucket.dispatchSamples.length > LATENCY_SAMPLES)
            bucket.dispatchSamples.shift();
        if (outcome.status === 'dropped') {
            this.noteIngressDrop(outcome.reason);
            bucket.dropped += 1;
            row.dropped += 1;
            bucket.dropsByReason[outcome.reason] = (bucket.dropsByReason[outcome.reason] ?? 0) + 1;
            this.lastOutcome = {
                t: Date.now(),
                type,
                mode,
                status: 'dropped',
                reason: outcome.reason,
                dispatchMs,
                clientLagMs,
            };
        }
        else {
            bucket.dispatched += 1;
            row.dispatched += 1;
            this.lastOutcome = {
                t: Date.now(),
                type,
                mode,
                status: 'dispatched',
                dispatchMs,
                clientLagMs,
            };
        }
        return outcome;
    }
    noteIngressDrop(reason) {
        this.ingressDropped += 1;
        this.ingressDropsByReason[reason] = (this.ingressDropsByReason[reason] ?? 0) + 1;
    }
    async dispatchIngress(input) {
        const intent = (0, intentTypes_1.normalizeDomInput)(input);
        return this.dispatchIntent(intent);
    }
    /** Lab blueprint helper — one-shot query for coords, then Mode A CDP. Not the live hot path. */
    async resolveInContext(selector, contextId, mode) {
        const frame = await (0, resolveVirtualNode_1.findFrameForContext)(this.page, contextId);
        if (!frame)
            return { ok: false, reason: 'context_frame_missing' };
        try {
            const argsJson = JSON.stringify({ sel: selector, click: mode === 'click' });
            const hit = await frame.evaluate(`((args) => {
          const p = globalThis.__speculumProjection;
          if (!p || !p.domNodes) return { ok: false, reason: 'producer' };
          const el = document.querySelector(args.sel);
          if (!el) return { ok: false, reason: 'missing_element' };
          const id = p.domNodes.keyOf(el);
          if (!id || id <= 0) return { ok: false, reason: 'no_node_id' };
          if (!args.click) return { ok: true, id, generation: p.domNodes.generation };
          const rect = el.getBoundingClientRect();
          return {
            ok: true,
            id,
            generation: p.domNodes.generation,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        })(${argsJson})`);
            if (!hit || typeof hit !== 'object' || !('ok' in hit)) {
                return { ok: false, reason: 'evaluate_empty' };
            }
            return hit;
        }
        catch {
            return { ok: false, reason: 'evaluate_failed' };
        }
    }
    async resolveAndClick(selector, contextId = frame_1.CONTEXT_ID_ROOT) {
        const info = await this.resolveInContext(selector, contextId, 'click');
        if (!info.ok || !info.id || info.x == null || info.y == null) {
            return { status: 'dropped', reason: info.reason ?? 'resolve_failed' };
        }
        // Nested blueprint: map frame-local center to page for CDP (harness only).
        let x = info.x;
        let y = info.y;
        if (contextId !== frame_1.CONTEXT_ID_ROOT) {
            const frame = await (0, resolveVirtualNode_1.findFrameForContext)(this.page, contextId);
            if (frame) {
                try {
                    const frameEl = await frame.frameElement();
                    const box = frameEl ? await frameEl.boundingBox() : null;
                    if (box) {
                        x = box.x + x;
                        y = box.y + y;
                    }
                }
                catch {
                    /* keep frame-local */
                }
            }
        }
        const payloadJson = JSON.stringify({
            x,
            y,
            button: 0,
            buttons: 0,
            modifiers: {},
        });
        const base = {
            generation: info.generation ?? 0,
            targetId: null,
            contextId: frame_1.CONTEXT_ID_ROOT,
            payloadJson,
            timestampClient: Date.now(),
            wallClientMs: Date.now(),
            type: 'mousemove',
        };
        for (const type of ['mousemove', 'mousedown', 'mouseup']) {
            const out = await this.dispatchIngress({ ...base, type });
            if (out.status === 'dropped')
                return out;
        }
        return { status: 'dispatched' };
    }
    async resolveAndType(selector, value, contextId = frame_1.CONTEXT_ID_ROOT) {
        const info = await this.resolveInContext(selector, contextId, 'id');
        if (!info.ok || !info.id) {
            return { status: 'dropped', reason: info.reason ?? 'resolve_failed' };
        }
        return this.dispatchIngress({
            type: 'input',
            targetId: info.id,
            contextId,
            generation: info.generation ?? 0,
            payloadJson: JSON.stringify({ value }),
            timestampClient: Date.now(),
            wallClientMs: Date.now(),
        });
    }
    async resolveAndScrollElement(selector, scrollTop, contextId = frame_1.CONTEXT_ID_ROOT) {
        const info = await this.resolveInContext(selector, contextId, 'id');
        if (!info.ok || !info.id) {
            return { status: 'dropped', reason: info.reason ?? 'resolve_failed' };
        }
        return this.dispatchIngress({
            type: 'scrollElement',
            targetId: info.id,
            contextId,
            generation: info.generation ?? 0,
            payloadJson: JSON.stringify({ scrollTop, scrollLeft: 0 }),
            timestampClient: Date.now(),
            wallClientMs: Date.now(),
        });
    }
    async resolveAndScrollViewport(scrollY, scrollX = 0, contextId = frame_1.CONTEXT_ID_ROOT) {
        return this.dispatchIngress({
            type: 'scrollViewport',
            targetId: null,
            contextId,
            generation: 0,
            payloadJson: JSON.stringify({ scrollX, scrollY }),
            timestampClient: Date.now(),
            wallClientMs: Date.now(),
        });
    }
}
exports.PageProjectionInputDispatch = PageProjectionInputDispatch;
//# sourceMappingURL=pageProjectionInputDispatch.js.map