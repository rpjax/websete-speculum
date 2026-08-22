"use strict";
/**
 * PageProjection input dispatch — serial CDP chain via legacy DomElementInput.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PageProjectionInputDispatch = void 0;
const DomElementInput_1 = require("../../../patchright/mirror/dom/DomElementInput");
const frame_1 = require("@speculum/page-projection/core/frame");
const intentTypes_1 = require("@speculum/page-projection/core/input/intentTypes");
const resolveVirtualNode_1 = require("./resolveVirtualNode");
class PageProjectionInputDispatch {
    page;
    domInput;
    host;
    cachedGeneration = 0;
    constructor(page) {
        this.page = page;
        const resolver = (0, resolveVirtualNode_1.createVirtualTargetResolver)(page);
        this.host = {
            getGeneration: () => this.cachedGeneration,
            takeUpload: () => undefined,
        };
        this.domInput = new DomElementInput_1.DomElementInput(page, this.host, {
            resolveTarget: (targetId, contextId) => resolver.resolve(targetId, contextId ?? frame_1.CONTEXT_ID_ROOT),
        });
    }
    async refreshGeneration(contextId = frame_1.CONTEXT_ID_ROOT) {
        this.cachedGeneration = await (0, resolveVirtualNode_1.readVirtualGeneration)(this.page, contextId);
        return this.cachedGeneration;
    }
    async dispatchIntent(intent) {
        await this.refreshGeneration(intent.contextId);
        let payloadJson = intent.payload;
        const type = intent.type.trim().toLowerCase();
        const needsPageCoords = intent.contextId !== frame_1.CONTEXT_ID_ROOT
            && (type === 'mousemove'
                || type === 'mousedown'
                || type === 'mouseup'
                || type === 'pointermove'
                || type === 'pointerdown'
                || type === 'pointerup'
                || type === 'wheel');
        if (needsPageCoords) {
            const mapped = await this.mapNestedPayloadToPage(intent.contextId, payloadJson);
            if (mapped == null)
                return { status: 'dropped', reason: 'frame_box_missing' };
            payloadJson = mapped;
        }
        return this.domInput.dispatch({
            type: intent.type,
            targetId: intent.nodeId,
            contextId: intent.contextId,
            generation: intent.generation,
            timestampClient: intent.timestampClient,
            payloadJson,
        });
    }
    async dispatchIngress(input) {
        const intent = (0, intentTypes_1.normalizeDomInput)(input);
        return this.dispatchIntent(intent);
    }
    /** Nested capture sends viewport-local coords; CDP mouse needs page coords. */
    async mapNestedPayloadToPage(contextId, payloadJson) {
        let payload;
        try {
            payload = JSON.parse(payloadJson);
        }
        catch {
            return null;
        }
        const x = Number(payload.x);
        const y = Number(payload.y);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return payloadJson;
        const frame = await (0, resolveVirtualNode_1.findFrameForContext)(this.page, contextId);
        const pagePt = await this.pageCoordsForFramePoint(frame, contextId, x, y);
        if (!pagePt)
            return null;
        return JSON.stringify({ ...payload, x: pagePt.x, y: pagePt.y });
    }
    async pageCoordsForFramePoint(frame, contextId, x, y) {
        if (!frame || contextId === frame_1.CONTEXT_ID_ROOT)
            return { x, y };
        try {
            const frameEl = await frame.frameElement();
            const box = frameEl ? await frameEl.boundingBox() : null;
            if (!box)
                return null;
            return { x: box.x + x, y: box.y + y };
        }
        catch {
            return null;
        }
    }
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
            // Frame-local coords — dispatchIntent maps nested → page for CDP mouse.
            return hit;
        }
        catch {
            return { ok: false, reason: 'evaluate_failed' };
        }
    }
    async resolveAndClick(selector, contextId = frame_1.CONTEXT_ID_ROOT) {
        const info = await this.resolveInContext(selector, contextId, 'click');
        if (!info.ok || !info.id || info.generation == null || info.x == null || info.y == null) {
            return { status: 'dropped', reason: info.reason ?? 'resolve_failed' };
        }
        const payloadJson = JSON.stringify({
            x: info.x,
            y: info.y,
            button: 0,
            buttons: 0,
            modifiers: {},
        });
        const base = {
            generation: info.generation,
            targetId: info.id,
            contextId,
            payloadJson,
            timestampClient: Date.now(),
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
        if (!info.ok || !info.id || info.generation == null) {
            return { status: 'dropped', reason: info.reason ?? 'resolve_failed' };
        }
        return this.dispatchIngress({
            type: 'input',
            targetId: info.id,
            contextId,
            generation: info.generation,
            payloadJson: JSON.stringify({ value }),
            timestampClient: Date.now(),
        });
    }
    async resolveAndScrollElement(selector, scrollTop, contextId = frame_1.CONTEXT_ID_ROOT) {
        const info = await this.resolveInContext(selector, contextId, 'id');
        if (!info.ok || !info.id || info.generation == null) {
            return { status: 'dropped', reason: info.reason ?? 'resolve_failed' };
        }
        return this.dispatchIngress({
            type: 'scrollElement',
            targetId: info.id,
            contextId,
            generation: info.generation,
            payloadJson: JSON.stringify({ scrollTop, scrollLeft: 0 }),
            timestampClient: Date.now(),
        });
    }
    async resolveAndScrollViewport(scrollY, scrollX = 0, contextId = frame_1.CONTEXT_ID_ROOT) {
        await this.refreshGeneration(contextId);
        return this.dispatchIngress({
            type: 'scrollViewport',
            targetId: null,
            contextId,
            generation: this.cachedGeneration,
            payloadJson: JSON.stringify({ scrollX, scrollY }),
            timestampClient: Date.now(),
        });
    }
}
exports.PageProjectionInputDispatch = PageProjectionInputDispatch;
//# sourceMappingURL=pageProjectionInputDispatch.js.map