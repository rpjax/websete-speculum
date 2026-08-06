"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomElementInput = void 0;
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
/**
 * Dom Projection CDP-only inject chain. Isolated from OsInputBackend.
 * No wire `click` — gesture is mouseMoved → mousePressed → mouseReleased.
 */
class DomElementInput {
    page;
    projection;
    chain = Promise.resolve();
    lastMove = null;
    pendingMove = null;
    /** Keys that used insertText on keydown — skip matching keyup. */
    insertTextKeys = new Set();
    constructor(page, projection) {
        this.page = page;
        this.projection = projection;
    }
    async dispatch(event) {
        let outcome = { status: 'dispatched' };
        const run = async () => {
            try {
                outcome = await this.dispatchNow(event);
            }
            catch {
                outcome = { status: 'dropped', reason: 'cdp_error' };
            }
        };
        this.chain = this.chain.then(run, run);
        await this.chain;
        return outcome;
    }
    async dispatchNow(event) {
        const type = event.type.trim().toLowerCase();
        if (type === 'resync') {
            await this.projection?.requestResync();
            return { status: 'dispatched' };
        }
        // Never honor wire click — would double-fire with pressed/released.
        if (type === 'click' || type === 'auxclick') {
            return { status: 'dropped', reason: 'ignored_wire_click' };
        }
        const currentGen = this.projection?.getGeneration?.() ?? 0;
        if (event.generation != null
            && event.generation > 0
            && currentGen > 0
            && event.generation !== currentGen) {
            return { status: 'dropped', reason: 'generation_stale' };
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
            const reason = await this.dispatchMouse('mousePressed', payload);
            return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
        }
        if (type === 'mouseup' || type === 'pointerup') {
            const reason = await this.dispatchMouse('mouseReleased', payload);
            return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
        }
        if (type === 'wheel') {
            await this.dispatchWheel(payload);
            return { status: 'dispatched' };
        }
        if (type === 'keydown' || type === 'keyup') {
            const reason = await this.dispatchKey(type, event.anchor, payload);
            return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
        }
        if (type === 'input') {
            const reason = await this.dispatchInput(event.anchor, payload);
            return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
        }
        if (type === 'setfiles') {
            const reason = await this.dispatchSetFiles(event.anchor, payload);
            return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
        }
        if (type === 'scroll') {
            const reason = await this.dispatchScroll(event.anchor, payload);
            return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
        }
        if (type === 'focus') {
            const reason = await this.focusAnchor(event.anchor);
            return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
        }
        if (type === 'blur') {
            const reason = await this.blurAnchor(event.anchor);
            return reason ? { status: 'dropped', reason } : { status: 'dispatched' };
        }
        return { status: 'dropped', reason: 'unknown_type' };
    }
    /** Queue latest move coords. Returns false when payload coords are invalid. */
    acceptMove(payload) {
        const x = Number(payload.x);
        const y = Number(payload.y);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return false;
        this.pendingMove = { x, y };
        return true;
    }
    async flushMove() {
        const next = this.pendingMove;
        this.pendingMove = null;
        if (!next)
            return;
        if (this.lastMove && this.lastMove.x === next.x && this.lastMove.y === next.y)
            return;
        this.lastMove = next;
        await this.page.mouse.move(next.x, next.y);
    }
    /** @returns drop reason or null when CDP work ran. */
    async dispatchMouse(type, payload) {
        const x = Number(payload.x);
        const y = Number(payload.y);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return 'invalid_coords';
        const button = mouseButtonName(payload.button);
        if (type === 'mousePressed') {
            await this.page.mouse.move(x, y);
            this.lastMove = { x, y };
            await this.page.mouse.down({ button });
        }
        else {
            await this.page.mouse.move(x, y);
            this.lastMove = { x, y };
            await this.page.mouse.up({ button });
        }
        return null;
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
    /** @returns drop reason or null when CDP work ran / intentional keyup skip after insertText. */
    async dispatchKey(type, anchor, payload) {
        if (anchor) {
            const focusReason = await this.focusAnchor(anchor);
            if (focusReason)
                return focusReason;
        }
        const key = typeof payload.key === 'string' ? payload.key : '';
        if (!key)
            return 'empty_key';
        if (type === 'keydown') {
            const mods = payload.modifiers;
            const hasMod = !!(mods?.alt || mods?.ctrl || mods?.meta);
            if (!hasMod && key.length === 1 && !payload.repeat) {
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
    async dispatchInput(anchor, payload) {
        const el = await this.resolveElement(anchor);
        if (!el)
            return 'anchor_missing';
        try {
            await el.focus();
            if (typeof payload.checked === 'boolean') {
                await el.evaluate((node, checked) => {
                    const input = node;
                    const Ev = globalThis.Event;
                    if (input.type === 'checkbox' || input.type === 'radio') {
                        input.checked = checked;
                        input.dispatchEvent(new Ev('input', { bubbles: true }));
                        input.dispatchEvent(new Ev('change', { bubbles: true }));
                    }
                }, payload.checked);
                return null;
            }
            const value = typeof payload.value === 'string' ? payload.value : '';
            await el.fill(value, { force: true, timeout: 2_000 }).catch(async () => {
                await el.evaluate((node, v) => {
                    const input = node;
                    const Ev = globalThis.Event;
                    if ('value' in input)
                        input.value = v;
                    input.dispatchEvent(new Ev('input', { bubbles: true }));
                    input.dispatchEvent(new Ev('change', { bubbles: true }));
                }, value);
            });
            return null;
        }
        finally {
            await el.dispose().catch(() => undefined);
        }
    }
    async dispatchSetFiles(anchor, payload) {
        const el = await this.resolveElement(anchor);
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
    async dispatchScroll(anchor, payload) {
        const top = Number(payload.scrollTop ?? 0);
        const left = Number(payload.scrollLeft ?? 0);
        if (!anchor) {
            await this.page.evaluate(({ top: t, left: l }) => {
                globalThis.scrollTo(l, t);
            }, { top, left });
            return null;
        }
        const el = await this.resolveElement(anchor);
        if (!el)
            return 'anchor_missing';
        try {
            await el.evaluate((node, pos) => {
                const n = node;
                n.scrollTop = pos.top;
                n.scrollLeft = pos.left;
            }, { top, left });
            return null;
        }
        finally {
            await el.dispose().catch(() => undefined);
        }
    }
    async focusAnchor(anchor) {
        const el = await this.resolveElement(anchor);
        if (!el)
            return 'anchor_missing';
        try {
            await el.focus();
            return null;
        }
        finally {
            await el.dispose().catch(() => undefined);
        }
    }
    async blurAnchor(anchor) {
        const el = await this.resolveElement(anchor);
        if (!el)
            return 'anchor_missing';
        try {
            await el.evaluate((node) => {
                const n = node;
                n.blur?.();
            });
            return null;
        }
        finally {
            await el.dispose().catch(() => undefined);
        }
    }
    async resolveElement(anchor) {
        if (!anchor)
            return null;
        for (let attempt = 0; attempt < 3; attempt++) {
            const handle = await this.page.evaluateHandle((a) => {
                const w = globalThis;
                return w.__speculumDomResolve?.(a) ?? null;
            }, anchor);
            const element = handle.asElement();
            if (element)
                return element;
            await handle.dispose().catch(() => undefined);
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
function mouseButtonName(button) {
    if (button === 1)
        return 'middle';
    if (button === 2)
        return 'right';
    return 'left';
}
//# sourceMappingURL=DomElementInput.js.map