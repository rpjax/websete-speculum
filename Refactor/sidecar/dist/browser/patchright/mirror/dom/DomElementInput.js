"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomElementInput = void 0;
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
/**
 * Dom Projection CDP-only inject chain. Isolated from OsInputBackend.
 * No wire `click` — gesture is mouseMoved → mousePressed → mouseReleased,
 * or touchMove → touchStart → touchEnd when intent `pointerType` is `touch`.
 */
class DomElementInput {
    page;
    projection;
    options;
    /** §6.4 defaults — collapse moves under inject-chain pressure. */
    static INJECT_CHAIN_MAX_DEPTH = 64;
    static INJECT_MOVE_COLLAPSE_AGE_MS = 50;
    static LATENCY_SAMPLES = 256;
    chain = Promise.resolve();
    chainDepth = 0;
    lastMove = null;
    pendingMove = null;
    pendingMoveAtMs = 0;
    /** At most one move-flush task on the inject chain (§6.4 coalesce). */
    moveFlushEnqueued = false;
    /** Active touch contact (Mode A touch path) — moves are touchMove only while down. */
    touchActive = false;
    touchPointerId = 1;
    cdp = null;
    /** Keys that used insertText on keydown — skip matching keyup. */
    insertTextKeys = new Set();
    received = 0;
    dispatched = 0;
    dropped = 0;
    dropsByReason = {};
    byType = {};
    chainDepthPeak = 0;
    moveCollapseCount = 0;
    moveHeldUnderDepth = 0;
    queueWaitSamples = [];
    injectSamples = [];
    lastOutcome = null;
    constructor(page, projection, options) {
        this.page = page;
        this.projection = projection;
        this.options = options;
    }
    getMetrics() {
        return {
            received: this.received,
            dispatched: this.dispatched,
            dropped: this.dropped,
            dropsByReason: { ...this.dropsByReason },
            byType: Object.fromEntries(Object.entries(this.byType).map(([k, v]) => [k, { ...v }])),
            chainDepthCurrent: this.chainDepth,
            chainDepthPeak: this.chainDepthPeak,
            moveCollapseCount: this.moveCollapseCount,
            moveHeldUnderDepth: this.moveHeldUnderDepth,
            pendingMove: this.pendingMove != null,
            moveFlushEnqueued: this.moveFlushEnqueued,
            queueWaitMs: latencyStats(this.queueWaitSamples),
            injectMs: latencyStats(this.injectSamples),
            lastOutcome: this.lastOutcome,
        };
    }
    async dispatch(event) {
        const type = event.type.trim().toLowerCase();
        const enqueuedAt = Date.now();
        // Coalesce moves: update latest sample; enqueue at most one flush (§6.4).
        // Presses/keys never sit behind a backlog of N move chain tasks.
        if (type === 'mousemove' || type === 'pointermove') {
            const payload = parsePayload(event.payloadJson);
            if (!this.acceptMove(payload)) {
                return this.finish(type, { status: 'dropped', reason: 'invalid_coords' });
            }
            // Under depth/age pressure: keep latest sample only — never deepen the chain
            // with another move-flush task (hard rule: collapse moves, never drop presses).
            const aged = this.pendingMoveAtMs > 0
                && Date.now() - this.pendingMoveAtMs >= DomElementInput.INJECT_MOVE_COLLAPSE_AGE_MS;
            if (this.moveFlushEnqueued
                || this.chainDepth >= DomElementInput.INJECT_CHAIN_MAX_DEPTH
                || aged) {
                if (!this.moveFlushEnqueued && this.chainDepth >= DomElementInput.INJECT_CHAIN_MAX_DEPTH) {
                    // Depth already saturated with protected work — sample is held in pendingMove
                    // and will flush before the next protected intent via flushMove().
                    this.moveHeldUnderDepth += 1;
                    return this.finish(type, { status: 'dispatched' });
                }
                if (this.moveFlushEnqueued) {
                    this.moveCollapseCount += 1;
                    return this.finish(type, { status: 'dispatched' });
                }
                if (aged)
                    this.moveCollapseCount += 1;
            }
            if (!this.moveFlushEnqueued) {
                this.moveFlushEnqueued = true;
                this.chainDepth += 1;
                this.noteDepthPeak();
                let flushOutcome = { status: 'dispatched' };
                const flush = this.chain.then(async () => {
                    this.moveFlushEnqueued = false;
                    this.pushSample(this.queueWaitSamples, Date.now() - enqueuedAt);
                    const injectStarted = Date.now();
                    try {
                        await this.flushMove();
                    }
                    catch {
                        flushOutcome = { status: 'dropped', reason: 'cdp_error' };
                    }
                    finally {
                        this.pushSample(this.injectSamples, Date.now() - injectStarted);
                        this.chainDepth = Math.max(0, this.chainDepth - 1);
                    }
                });
                this.chain = flush;
                await flush;
                return this.finish(type, flushOutcome);
            }
            this.moveCollapseCount += 1;
            return this.finish(type, { status: 'dispatched' });
        }
        let outcome = { status: 'dispatched' };
        this.chainDepth += 1;
        this.noteDepthPeak();
        const run = async () => {
            this.pushSample(this.queueWaitSamples, Date.now() - enqueuedAt);
            const injectStarted = Date.now();
            try {
                outcome = await this.dispatchNow(event);
            }
            catch {
                outcome = { status: 'dropped', reason: 'cdp_error' };
            }
            finally {
                this.pushSample(this.injectSamples, Date.now() - injectStarted);
                this.chainDepth = Math.max(0, this.chainDepth - 1);
            }
        };
        this.chain = this.chain.then(run, run);
        await this.chain;
        return this.finish(type, outcome);
    }
    finish(type, outcome) {
        this.received += 1;
        let row = this.byType[type];
        if (!row) {
            row = { received: 0, dispatched: 0, dropped: 0 };
            this.byType[type] = row;
        }
        row.received += 1;
        if (outcome.status === 'dropped') {
            this.dropped += 1;
            row.dropped += 1;
            this.dropsByReason[outcome.reason] = (this.dropsByReason[outcome.reason] ?? 0) + 1;
            this.lastOutcome = { t: Date.now(), type, status: 'dropped', reason: outcome.reason };
        }
        else {
            this.dispatched += 1;
            row.dispatched += 1;
            this.lastOutcome = { t: Date.now(), type, status: 'dispatched' };
        }
        return outcome;
    }
    noteDepthPeak() {
        if (this.chainDepth > this.chainDepthPeak)
            this.chainDepthPeak = this.chainDepth;
    }
    pushSample(bucket, value) {
        bucket.push(value);
        if (bucket.length > DomElementInput.LATENCY_SAMPLES)
            bucket.shift();
    }
    async dispatchNow(event) {
        const type = event.type.trim().toLowerCase();
        if (type === 'resync') {
            // I2: there is no input intent named resync — OOB PageProjection.Resync only.
            return { status: 'dropped', reason: 'resync_not_an_intent' };
        }
        // Never honor wire click — would double-fire with pressed/released.
        if (type === 'click' || type === 'auxclick') {
            return { status: 'dropped', reason: 'ignored_wire_click' };
        }
        const payload = parsePayload(event.payloadJson);
        if (type === 'mousemove' || type === 'pointermove') {
            if (!this.acceptMove(payload)) {
                return { status: 'dropped', reason: 'invalid_coords' };
            }
            // Flush on the input chain (not a detached microtask) so CDP failures become CdpDropped.
            await this.flushMove();
            return { status: 'dispatched' };
        }
        await this.flushMove();
        if (type === 'mousedown' || type === 'pointerdown') {
            const reason = isTouchPointer(payload)
                ? await this.dispatchTouch('touchStart', payload)
                : await this.dispatchMouse('mousePressed', payload);
            return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
        }
        if (type === 'mouseup' || type === 'pointerup') {
            const reason = isTouchPointer(payload)
                ? await this.dispatchTouch('touchEnd', payload)
                : await this.dispatchMouse('mouseReleased', payload);
            return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
        }
        if (type === 'wheel') {
            await this.dispatchWheel(payload);
            return { status: 'dispatched' };
        }
        if (type === 'keydown' || type === 'keyup') {
            const reason = await this.dispatchKey(type, event.anchor, payload, event.targetId, event.contextId);
            return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
        }
        // Mode B (scrollElement / focus / blur / input) is Control → Virtual.domNodes — not CDP here.
        if (type === 'input'
            || type === 'scrollelement'
            || type === 'focus'
            || type === 'blur') {
            return { status: 'dropped', reason: 'mode_b_via_control' };
        }
        if (type === 'setfiles') {
            const reason = await this.dispatchSetFiles(event.anchor, payload, event.targetId, event.contextId);
            return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
        }
        if (type === 'scrollviewport') {
            await this.dispatchScrollViewport(payload);
            return { status: 'dispatched' };
        }
        return { status: 'dropped', reason: 'unknown_type' };
    }
    /** Queue latest move coords. Returns false when payload coords are invalid. */
    acceptMove(payload) {
        const x = Number(payload.x);
        const y = Number(payload.y);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return false;
        this.pendingMove = {
            x,
            y,
            touch: isTouchPointer(payload),
            pointerId: touchPointerId(payload),
        };
        this.pendingMoveAtMs = Date.now();
        return true;
    }
    async flushMove() {
        const next = this.pendingMove;
        this.pendingMove = null;
        this.pendingMoveAtMs = 0;
        if (!next)
            return;
        if (this.lastMove && this.lastMove.x === next.x && this.lastMove.y === next.y)
            return;
        if (next.touch) {
            // Finger move without an active contact is not a hover — drop (sites must not see mouseover).
            if (!this.touchActive)
                return;
            this.lastMove = { x: next.x, y: next.y };
            await this.sendTouch('touchMove', next.x, next.y, next.pointerId);
            return;
        }
        this.lastMove = { x: next.x, y: next.y };
        await this.page.mouse.move(next.x, next.y);
    }
    /**
     * Mode A press/release: CDP at payload viewport coords. No resolve / boundingBox.
     * Miss or wrong target = expected under fire-and-forget.
     */
    async dispatchMouse(type, payload) {
        const x = Number(payload.x);
        const y = Number(payload.y);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return 'invalid_coords';
        const button = mouseButtonName(payload.button);
        await this.page.mouse.move(x, y);
        this.lastMove = { x, y };
        if (type === 'mousePressed') {
            await this.page.mouse.down({ button });
        }
        else {
            await this.page.mouse.up({ button });
        }
        return null;
    }
    /** Mode A touch — CDP `Input.dispatchTouchEvent` (same path as PatchrightInputBackend.touch). */
    async dispatchTouch(type, payload) {
        const x = Number(payload.x);
        const y = Number(payload.y);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return 'invalid_coords';
        const id = touchPointerId(payload);
        if (type === 'touchStart') {
            this.touchActive = true;
            this.touchPointerId = id;
            this.lastMove = { x, y };
            await this.sendTouch('touchStart', x, y, id);
            return null;
        }
        // Release: empty touchPoints ends the contact (CDP convention).
        this.touchActive = false;
        this.lastMove = { x, y };
        await this.sendTouch('touchEnd', x, y, id);
        return null;
    }
    async sendTouch(type, x, y, id) {
        const cdp = await this.ensureCdp();
        if (type === 'touchEnd') {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            return;
        }
        await cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: [{ x, y, id }],
        });
    }
    async ensureCdp() {
        if (this.cdp)
            return this.cdp;
        this.cdp = await this.page.context().newCDPSession(this.page);
        return this.cdp;
    }
    async dispatchWheel(payload) {
        const x = Number(payload.x);
        const y = Number(payload.y);
        const deltaX = Number(payload.deltaX ?? 0);
        const deltaY = Number(payload.deltaY ?? 0);
        if (Number.isFinite(x) && Number.isFinite(y)) {
            await this.page.mouse.move(x, y);
            this.lastMove = { x, y };
        }
        await this.page.mouse.wheel(deltaX, deltaY);
    }
    /** Mode A key — CDP to current focus. For non-text keys with nodeId, focus that element first. */
    async dispatchKey(type, _anchor, payload, targetId, contextId) {
        const key = typeof payload.key === 'string' ? payload.key : '';
        if (!key)
            return 'empty_key';
        if (type === 'keydown') {
            const mods = payload.modifiers;
            const hasMod = !!(mods?.alt || mods?.ctrl || mods?.meta);
            const insertText = !hasMod && key.length === 1 && !payload.repeat;
            // Enter / Tab / arrows / chords need focus on the target. Plain typing uses insertText.
            if (!insertText && targetId != null && targetId > 0) {
                const el = await this.resolveElement(null, targetId, contextId);
                if (el) {
                    try {
                        await el.focus();
                    }
                    catch {
                        /* ignore */
                    }
                    finally {
                        await el.dispose().catch(() => undefined);
                    }
                }
            }
            if (insertText) {
                await this.page.keyboard.insertText(key);
                this.insertTextKeys.add(key);
                return null;
            }
            await this.page.keyboard.down(key);
        }
        else {
            if (this.insertTextKeys.has(key)) {
                this.insertTextKeys.delete(key);
                return null;
            }
            await this.page.keyboard.up(key);
        }
        return null;
    }
    async dispatchSetFiles(anchor, payload, targetId, contextId) {
        const el = await this.resolveElement(anchor, targetId, contextId);
        if (!el)
            return 'anchor_missing';
        if (!payload.files?.length) {
            await el.dispose().catch(() => undefined);
            return 'empty_files';
        }
        const paths = [];
        try {
            for (const file of payload.files) {
                let body = null;
                if (file.uploadId && this.projection) {
                    const u = this.projection.takeUpload(file.uploadId);
                    if (u)
                        body = u.body;
                }
                if (!body && file.bytesBase64) {
                    body = Buffer.from(file.bytesBase64, 'base64');
                }
                if (!body)
                    continue;
                const path = (0, node_path_1.join)((0, node_os_1.tmpdir)(), `speculum-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`);
                await node_fs_1.promises.writeFile(path, body);
                paths.push(path);
            }
            if (!paths.length)
                return 'empty_files';
            await el.setInputFiles(paths);
            return null;
        }
        finally {
            await el.dispose().catch(() => undefined);
            for (const p of paths) {
                await node_fs_1.promises.unlink(p).catch(() => undefined);
            }
        }
    }
    /** Viewport scroller — absolute page position, no anchor. */
    async dispatchScrollViewport(payload) {
        const x = Number(payload.scrollX ?? 0);
        const y = Number(payload.scrollY ?? 0);
        await this.page.evaluate(({ x: left, y: top }) => {
            const g = globalThis;
            const note = g.__speculumDomNoteScrollEcho ?? g.top?.__speculumDomNoteScrollEcho;
            const consume = g.__speculumDomConsumeScrollEchoIfAt ?? g.top?.__speculumDomConsumeScrollEchoIfAt;
            const mark = { viewport: { x: left, y: top } };
            // Contract: note before mutate so sync scroll sensors see the echo mark.
            note?.(mark);
            const beforeX = g.scrollX || 0;
            const beforeY = g.scrollY || 0;
            g.scrollTo(left, top);
            const afterX = g.scrollX || 0;
            const afterY = g.scrollY || 0;
            // True no-op (no scroll event): consume mark. If position moved, leave
            // mark for the scroll sensor (do not race async delivery).
            if (beforeX === afterX
                && beforeY === afterY
                && afterX === left
                && afterY === top) {
                consume?.(mark);
            }
        }, { x, y });
    }
    /**
     * Pierce-aware resolve (input §6.7 / redesign §5.11):
     * Prefer uint32 targetId via __speculumPageProjectionV2.reverse map;
     * fall back to deprecated speculum-anchor string for V1 transition.
     */
    async resolveElement(anchor, targetId, contextId) {
        if (targetId && targetId > 0 && this.options?.resolveTarget) {
            for (let attempt = 0; attempt < 3; attempt++) {
                const el = await this.options.resolveTarget(targetId, contextId);
                if (el)
                    return el;
                await new Promise((r) => setTimeout(r, 16 * (attempt + 1)));
            }
            // miss → fall through to legacy resolve when anchor present
        }
        if (targetId && targetId > 0) {
            for (let attempt = 0; attempt < 3; attempt++) {
                for (const frame of this.page.frames()) {
                    try {
                        const handle = await frame.evaluateHandle((id) => {
                            const w = globalThis;
                            return w.__speculumPageProjectionV2?.resolve?.(id) ?? null;
                        }, targetId);
                        const element = handle.asElement();
                        if (element)
                            return element;
                        await handle.dispose().catch(() => undefined);
                    }
                    catch {
                        /* frame detached */
                    }
                }
                await new Promise((r) => setTimeout(r, 16 * (attempt + 1)));
            }
            // miss → retry-then-drop (AnchorMiss) — fall through to anchor if present
        }
        if (!anchor)
            return null;
        for (let attempt = 0; attempt < 3; attempt++) {
            for (const frame of this.page.frames()) {
                try {
                    const handle = await frame.evaluateHandle((a) => {
                        const w = globalThis;
                        const resolved = w.__speculumDomResolve?.(a);
                        if (resolved)
                            return resolved;
                        const esc = typeof w.CSS?.escape === 'function'
                            ? w.CSS.escape(a)
                            : String(a).replace(/["\\]/g, '\\$&');
                        return w.document?.querySelector('[speculum-anchor="' + esc + '"]') ?? null;
                    }, anchor);
                    const element = handle.asElement();
                    if (element)
                        return element;
                    await handle.dispose().catch(() => undefined);
                }
                catch {
                    /* frame detached mid-flight */
                }
            }
            await new Promise((r) => setTimeout(r, 16 * (attempt + 1)));
        }
        return null;
    }
}
exports.DomElementInput = DomElementInput;
function parsePayload(raw) {
    try {
        const v = JSON.parse(raw ?? '{}');
        return v && typeof v === 'object' ? v : {};
    }
    catch {
        return {};
    }
}
/** Client `PointerEvent.pointerType === 'touch'` → CDP touch path (not mouse hover). */
function isTouchPointer(payload) {
    return payload.pointerType === 'touch';
}
function touchPointerId(payload) {
    const id = payload.pointerId;
    if (typeof id === 'number' && Number.isFinite(id) && id > 0)
        return Math.floor(id);
    return 1;
}
function mouseButtonName(button) {
    if (button === 1)
        return 'middle';
    if (button === 2)
        return 'right';
    return 'left';
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
//# sourceMappingURL=DomElementInput.js.map