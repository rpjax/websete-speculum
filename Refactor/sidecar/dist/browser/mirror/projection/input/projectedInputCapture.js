"use strict";
/**
 * Projected surface input capture — intents only; never touches frame apply logic.
 * Ported from web `interaction.ts` with V2 envelope (`contextId`, `nodeId`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachProjectedInputCapture = attachProjectedInputCapture;
exports.attachNestedProjectedInputCapture = attachNestedProjectedInputCapture;
const intentTypes_1 = require("./intentTypes");
const INTERACTIVE = 'a, button, [role="button"], input, select, textarea, summary, label, [role="link"], [role="menuitem"]';
function attachProjectedInputCapture(surface, registry, send, opts) {
    const fire = (intent) => {
        if (!opts.isArmed())
            return;
        void Promise.resolve(send(intent)).catch(() => undefined);
    };
    const intent = (type, nodeId, payload) => ({
        schemaVersion: intentTypes_1.INTENT_SCHEMA_VERSION,
        contextId: opts.contextId,
        generation: opts.getGeneration(),
        type,
        nodeId,
        timestampClient: performance.now(),
        payload,
    });
    const nodeIdAtPoint = (clientX, clientY) => {
        const parentDoc = surface.ownerDocument;
        let stack;
        try {
            stack = parentDoc.elementsFromPoint(clientX, clientY);
        }
        catch {
            stack = [];
        }
        for (const node of stack) {
            if (!(node instanceof HTMLIFrameElement) || !surface.contains(node))
                continue;
            const childDoc = node.contentDocument;
            if (!childDoc)
                continue;
            const rect = node.getBoundingClientRect();
            const cx = clientX - rect.left;
            const cy = clientY - rect.top;
            let inner;
            try {
                inner = childDoc.elementsFromPoint(cx, cy);
            }
            catch {
                continue;
            }
            const hit = pickInteractiveId(inner);
            if (hit != null)
                return hit;
        }
        return pickInteractiveId(stack.filter((n) => surface.contains(n)));
    };
    const pickInteractiveId = (stack) => {
        let fallback = null;
        for (const node of stack) {
            const anchored = node.closest(INTERACTIVE) ?? node;
            const id = registry.idOfNearest(anchored);
            if (id == null)
                continue;
            if (anchored.matches(INTERACTIVE))
                return id;
            if (fallback == null)
                fallback = id;
        }
        return fallback;
    };
    const nodeIdOf = (target, point) => {
        if (point) {
            const hit = nodeIdAtPoint(point.x, point.y);
            if (hit != null)
                return hit;
        }
        if (!(target instanceof Node))
            return null;
        return registry.idOfNearest(target) ?? null;
    };
    const surfaceCoords = (event) => {
        const rect = surface.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0)
            return null;
        const { width: vw, height: vh } = opts.getViewportSize();
        if (vw <= 0 || vh <= 0)
            return null;
        const x = (event.clientX - rect.left) * (vw / rect.width);
        const y = (event.clientY - rect.top) * (vh / rect.height);
        return { x: Math.min(Math.max(x, 0), vw), y: Math.min(Math.max(y, 0), vh) };
    };
    const basePayload = (event, extra = {}) => {
        const coords = surfaceCoords(event);
        if (!coords)
            return null;
        return JSON.stringify({
            x: coords.x,
            y: coords.y,
            button: 'button' in event ? event.button : 0,
            buttons: 'buttons' in event ? event.buttons : 0,
            modifiers: { alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey },
            ...extra,
        });
    };
    let moveRaf = 0;
    let pendingMove = null;
    const flushMove = () => {
        moveRaf = 0;
        const m = pendingMove;
        pendingMove = null;
        if (m)
            fire(m);
    };
    const onPointerMove = (event) => {
        if (!opts.isArmed())
            return;
        const payload = basePayload(event);
        if (!payload)
            return;
        pendingMove = intent('mousemove', null, payload);
        if (!moveRaf)
            moveRaf = requestAnimationFrame(flushMove);
    };
    const onPointerDown = (event) => {
        if (!opts.isArmed())
            return;
        if (moveRaf) {
            cancelAnimationFrame(moveRaf);
            flushMove();
        }
        const payload = basePayload(event);
        if (!payload)
            return;
        fire(intent('mousedown', nodeIdOf(event.target, { x: event.clientX, y: event.clientY }), payload));
    };
    const onPointerUp = (event) => {
        if (!opts.isArmed())
            return;
        const payload = basePayload(event);
        if (!payload)
            return;
        fire(intent('mouseup', nodeIdOf(event.target, { x: event.clientX, y: event.clientY }), payload));
    };
    const onClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };
    const onSubmit = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };
    const onContextMenu = (event) => event.preventDefault();
    const onWheel = (event) => {
        if (!opts.isArmed())
            return;
        event.preventDefault();
        const payload = basePayload(event, { deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode });
        if (!payload)
            return;
        fire(intent('wheel', nodeIdOf(event.target, { x: event.clientX, y: event.clientY }), payload));
    };
    const onInput = (event) => {
        if (!opts.isArmed())
            return;
        const target = event.target;
        if (!(target instanceof HTMLElement))
            return;
        const nodeId = registry.idOfNearest(target);
        if (nodeId == null)
            return;
        opts.onMarkPropDirty?.(nodeId);
        let value = '';
        let checked;
        if (target instanceof HTMLInputElement
            || target instanceof HTMLTextAreaElement
            || target instanceof HTMLSelectElement) {
            value = target.value;
            if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio')) {
                checked = target.checked;
            }
        }
        fire(intent('input', nodeId, JSON.stringify({ value, checked })));
    };
    const onKey = (event) => {
        if (!opts.isArmed())
            return;
        if (event.key === 'Enter'
            && (event.target instanceof HTMLAnchorElement
                || (event.target instanceof HTMLButtonElement && event.target.type === 'submit')
                || (event.target instanceof HTMLInputElement
                    && (event.target.type === 'submit' || event.target.type === 'image')))) {
            event.preventDefault();
            event.stopPropagation();
        }
        const nodeId = nodeIdOf(event.target);
        fire(intent(event.type === 'keyup' ? 'keyup' : 'keydown', nodeId, JSON.stringify({
            key: event.key,
            code: event.code,
            repeat: event.repeat,
            modifiers: { alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey },
        })));
    };
    let scrollRaf = 0;
    let pendingViewport = null;
    const pendingElements = new Map();
    const flushScroll = () => {
        scrollRaf = 0;
        if (pendingViewport) {
            const v = pendingViewport;
            pendingViewport = null;
            fire(v);
        }
        for (const [id, msg] of pendingElements) {
            pendingElements.delete(id);
            fire(msg);
        }
    };
    const onScroll = (event) => {
        if (!opts.isArmed())
            return;
        const el = event.target;
        const doc = surface.ownerDocument;
        if (el === doc || el === doc.defaultView) {
            const win = doc.defaultView;
            const top = win.scrollY;
            const left = win.scrollX;
            if (opts.consumeScrollEcho?.('viewport', { top, left })) {
                opts.onProgrammaticScrollSuppress?.('viewport');
                return;
            }
            pendingViewport = intent('scrollViewport', null, JSON.stringify({ scrollX: left, scrollY: top }));
            if (!scrollRaf)
                scrollRaf = requestAnimationFrame(flushScroll);
            return;
        }
        if (!(el instanceof Element))
            return;
        const nodeId = registry.idOfNearest(el);
        if (nodeId == null)
            return;
        const top = el.scrollTop;
        const left = el.scrollLeft;
        if (opts.consumeScrollEcho?.(nodeId, { top, left })) {
            opts.onProgrammaticScrollSuppress?.(nodeId);
            return;
        }
        pendingElements.set(nodeId, intent('scrollElement', nodeId, JSON.stringify({ scrollTop: top, scrollLeft: left })));
        if (!scrollRaf)
            scrollRaf = requestAnimationFrame(flushScroll);
    };
    const onFocusIn = (event) => {
        if (!opts.isArmed())
            return;
        const nodeId = nodeIdOf(event.target);
        if (nodeId == null)
            return;
        fire(intent('focus', nodeId, '{}'));
    };
    const onFocusOut = (event) => {
        if (!opts.isArmed())
            return;
        const nodeId = nodeIdOf(event.target);
        if (nodeId == null)
            return;
        fire(intent('blur', nodeId, '{}'));
    };
    surface.addEventListener('pointermove', onPointerMove);
    surface.addEventListener('pointerdown', onPointerDown);
    surface.addEventListener('pointerup', onPointerUp);
    surface.addEventListener('click', onClick, true);
    surface.addEventListener('submit', onSubmit, true);
    surface.addEventListener('contextmenu', onContextMenu, true);
    surface.addEventListener('wheel', onWheel, { passive: false });
    surface.addEventListener('input', onInput, true);
    surface.addEventListener('change', onInput, true);
    surface.addEventListener('keydown', onKey, true);
    surface.addEventListener('keyup', onKey, true);
    surface.addEventListener('scroll', onScroll, true);
    surface.addEventListener('focusin', onFocusIn, true);
    surface.addEventListener('focusout', onFocusOut, true);
    return () => {
        if (moveRaf)
            cancelAnimationFrame(moveRaf);
        if (scrollRaf)
            cancelAnimationFrame(scrollRaf);
        surface.removeEventListener('pointermove', onPointerMove);
        surface.removeEventListener('pointerdown', onPointerDown);
        surface.removeEventListener('pointerup', onPointerUp);
        surface.removeEventListener('click', onClick, true);
        surface.removeEventListener('submit', onSubmit, true);
        surface.removeEventListener('contextmenu', onContextMenu, true);
        surface.removeEventListener('wheel', onWheel);
        surface.removeEventListener('input', onInput, true);
        surface.removeEventListener('change', onInput, true);
        surface.removeEventListener('keydown', onKey, true);
        surface.removeEventListener('keyup', onKey, true);
        surface.removeEventListener('scroll', onScroll, true);
        surface.removeEventListener('focusin', onFocusIn, true);
        surface.removeEventListener('focusout', onFocusOut, true);
    };
}
/** Nested child document — same capture, scoped contextId + registry. */
function attachNestedProjectedInputCapture(surface, registry, send, opts) {
    return attachProjectedInputCapture(surface, registry, send, opts);
}
//# sourceMappingURL=projectedInputCapture.js.map