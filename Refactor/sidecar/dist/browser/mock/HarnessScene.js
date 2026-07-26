"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HarnessScene = void 0;
const Navigation_1 = require("../patchright/Navigation");
/**
 * Interactive mock page state for stream + input feel testing.
 */
class HarnessScene {
    events;
    width;
    height;
    url = 'https://mock.local/';
    history = ['https://mock.local/'];
    historyIndex = 0;
    scrollY = 0;
    docScale = 1;
    cursor = null;
    trail = [];
    mouseButton = null;
    ripples = [];
    touches = new Map();
    heldKeys = new Set();
    textBuffer = '';
    editableFocused = false;
    navFlash = null;
    evalToast = null;
    inputCount = 0;
    lastInputType = '';
    lastInputAt = 0;
    pinchStartDist = null;
    pinchStartScale = 1;
    allowedDomains;
    constructor(width, height, events) {
        this.events = events;
        this.width = width;
        this.height = height;
    }
    get currentUrl() {
        return this.url;
    }
    get historyIndexValue() {
        return this.historyIndex;
    }
    resize(width, height) {
        this.width = width;
        this.height = height;
    }
    setAllowedDomains(domains) {
        this.allowedDomains = domains;
    }
    /** Initial location after launch. */
    bootstrap(url = 'https://mock.local/') {
        this.url = url;
        this.history = [url];
        this.historyIndex = 0;
        this.events.onLocationChanged(url);
    }
    navigateTo(url, pushHistory) {
        if (!this.isAllowed(url)) {
            this.events.onMainFrameNavigationBlocked(url);
            return false;
        }
        this.url = url;
        if (pushHistory) {
            this.history = this.history.slice(0, this.historyIndex + 1);
            this.history.push(url);
            this.historyIndex = this.history.length - 1;
        }
        this.events.onLocationChanged(url);
        return true;
    }
    refresh() {
        this.events.onLocationChanged(this.url);
    }
    noteEvaluate(code) {
        this.evalToast = { text: `[eval] ${code.slice(0, 72)}`, at: Date.now() };
    }
    applyInput(input) {
        const now = Date.now();
        this.inputCount++;
        this.lastInputType = input.type;
        this.lastInputAt = now;
        this.prune(now);
        switch (input.type) {
            case 'mousemove':
                this.setCursor(input.x, input.y);
                break;
            case 'mousedown':
                this.setCursor(input.x, input.y);
                this.mouseButton = input.button;
                this.ripples.push({ x: input.x, y: input.y, bornAt: now });
                this.handleClick(input.x, input.y);
                break;
            case 'mouseup':
                this.setCursor(input.x, input.y);
                this.mouseButton = null;
                break;
            case 'wheel':
                this.setCursor(input.x, input.y);
                this.scrollY = clamp(this.scrollY + input.deltaY, 0, 1600);
                break;
            case 'keydown':
                this.heldKeys.add(input.key);
                if (this.editableFocused && input.key === 'Backspace') {
                    this.textBuffer = this.textBuffer.slice(0, -1);
                }
                break;
            case 'keyup':
                this.heldKeys.delete(input.key);
                break;
            case 'type':
            case 'text':
                if (this.editableFocused || input.type === 'text') {
                    this.setEditableFocused(true);
                    this.textBuffer += input.text;
                }
                break;
            case 'touch':
                this.applyTouch(input.phase, input.points, now);
                break;
            case 'goback':
                this.goHistory(-1);
                break;
            case 'goforward':
                this.goHistory(1);
                break;
        }
    }
    snapshot(meta) {
        this.prune(meta.nowMs);
        return {
            nowMs: meta.nowMs,
            url: this.url,
            historyIndex: this.historyIndex,
            historyLength: this.history.length,
            scrollY: this.scrollY,
            docScale: this.docScale,
            cursor: this.cursor,
            trail: [...this.trail],
            mouseButton: this.mouseButton,
            ripples: [...this.ripples],
            touches: [...this.touches.entries()].map(([id, p]) => ({ id, ...p })),
            heldKeys: [...this.heldKeys],
            textBuffer: this.textBuffer,
            editableFocused: this.editableFocused,
            backHit: this.backHit(),
            forwardHit: this.forwardHit(),
            urlHit: this.urlHit(),
            editableHit: this.editableHitDoc(),
            navFlash: this.navFlash,
            evalToast: this.evalToast,
            inputCount: this.inputCount,
            lastInputType: this.lastInputType,
            lastInputAt: this.lastInputAt,
            emitFps: meta.emitFps,
            encodeMs: meta.encodeMs,
            jpegQuality: meta.jpegQuality,
        };
    }
    applyTouch(phase, points, now) {
        if (phase === 'end' || phase === 'cancel') {
            this.touches.clear();
            this.pinchStartDist = null;
            return;
        }
        this.touches.clear();
        for (const p of points) {
            this.touches.set(p.id, { x: p.x, y: p.y, force: p.force });
        }
        if (points.length >= 2) {
            const a = points[0];
            const b = points[1];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            if (this.pinchStartDist === null) {
                this.pinchStartDist = dist;
                this.pinchStartScale = this.docScale;
            }
            else if (this.pinchStartDist > 0) {
                this.docScale = clamp(this.pinchStartScale * (dist / this.pinchStartDist), 0.5, 2.5);
            }
        }
        else {
            this.pinchStartDist = null;
            if (phase === 'start' && points[0]) {
                this.ripples.push({ x: points[0].x, y: points[0].y, bornAt: now });
                this.handleClick(points[0].x, points[0].y);
            }
        }
    }
    handleClick(x, y) {
        if (contains(this.backHit(), x, y)) {
            this.goHistory(-1);
            return;
        }
        if (contains(this.forwardHit(), x, y)) {
            this.goHistory(1);
            return;
        }
        // Editable field is in document space — map screen → doc
        const screenField = this.editableHitScreen();
        if (contains(screenField, x, y)) {
            this.setEditableFocused(true);
            return;
        }
        if (this.editableFocused) {
            this.setEditableFocused(false);
        }
    }
    goHistory(delta) {
        const next = this.historyIndex + delta;
        if (next < 0 || next >= this.history.length)
            return;
        this.historyIndex = next;
        this.url = this.history[next];
        this.navFlash = { dir: delta < 0 ? 'back' : 'forward', at: Date.now() };
        this.events.onLocationChanged(this.url);
    }
    setEditableFocused(focused) {
        if (this.editableFocused === focused)
            return;
        this.editableFocused = focused;
        if (focused) {
            this.events.onEditableFocusChanged({
                inputMode: 'text',
                multiline: false,
                tagName: 'INPUT',
            });
        }
        else {
            this.events.onEditableFocusChanged(null);
        }
    }
    setCursor(x, y) {
        this.cursor = { x, y };
        this.trail.push({ x, y });
        if (this.trail.length > 12)
            this.trail.shift();
    }
    isAllowed(url) {
        if (!this.allowedDomains || this.allowedDomains.length === 0)
            return true;
        try {
            const host = new URL(url).hostname;
            return (0, Navigation_1.matchesAllowedDomain)(host, this.allowedDomains);
        }
        catch {
            return false;
        }
    }
    prune(now) {
        this.ripples = this.ripples.filter((r) => now - r.bornAt < 500);
        if (this.navFlash && now - this.navFlash.at > 450)
            this.navFlash = null;
        if (this.evalToast && now - this.evalToast.at > 1600)
            this.evalToast = null;
    }
    backHit() {
        return { x: 10, y: 8, w: 72, h: 28 };
    }
    forwardHit() {
        return { x: 90, y: 8, w: 96, h: 28 };
    }
    urlHit() {
        return { x: 200, y: 8, w: Math.max(120, this.width - 220), h: 28 };
    }
    /** Editable hit in document (pre-transform) coordinates. */
    editableHitDoc() {
        return { x: 40, y: 120, w: Math.min(480, this.width - 80), h: 44 };
    }
    /** Approximate screen-space editable hit for click tests. */
    editableHitScreen() {
        const toolbarH = 44;
        const pad = 12;
        const docY = toolbarH + pad;
        const field = this.editableHitDoc();
        return {
            x: pad + field.x * this.docScale,
            y: docY + (field.y - this.scrollY) * this.docScale,
            w: field.w * this.docScale,
            h: field.h * this.docScale,
        };
    }
}
exports.HarnessScene = HarnessScene;
function contains(r, x, y) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}
//# sourceMappingURL=HarnessScene.js.map