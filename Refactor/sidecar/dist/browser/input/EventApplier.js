"use strict";
/**
 * Serial EventApplier — routes unified intents (sparse-cdp / live-node only).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventApplier = void 0;
class EventApplier {
    opts;
    running = false;
    constructor(opts) {
        this.opts = opts;
    }
    enqueue(intent) {
        this.opts.buffer.enqueue(intent);
        void this.pump();
    }
    /** Wait until the serial queue is empty (lab helpers / resolveAnd*). */
    async flush() {
        for (;;) {
            if (!this.running && this.opts.buffer.isEmpty())
                return;
            await new Promise((r) => setTimeout(r, 5));
        }
    }
    async pump() {
        if (this.running)
            return;
        this.running = true;
        try {
            for (;;) {
                const intent = this.opts.buffer.drainOne();
                if (!intent)
                    break;
                await this.applyOne(intent);
            }
        }
        finally {
            this.running = false;
        }
    }
    async applyOne(intent) {
        switch (intent.type) {
            case 'move':
                // Sparse catalog rejects continuous move at the peripheral; still validate stamp.
                if (!this.validatePointer(intent))
                    return;
                this.opts.pointer.moveTo(intent.x, intent.y);
                return;
            case 'down':
            case 'up': {
                if (!this.validatePointer(intent))
                    return;
                const delivery = this.opts.clickDelivery;
                if (intent.nodeId == null) {
                    this.opts.pointer.moveTo(intent.x, intent.y);
                    this.opts.pointer.button(intent.button ?? 'left', intent.type === 'down');
                    return;
                }
                const resolved = await delivery.resolveClickTarget(intent.contextId ?? 1, intent.nodeId);
                if (!resolved.ok || resolved.x == null || resolved.y == null) {
                    this.reject(resolved.reason ? `resolve_click_failed:${resolved.reason}` : 'resolve_click_failed', 'virtual_resolve');
                    return;
                }
                this.opts.pointer.moveTo(resolved.x, resolved.y);
                this.opts.pointer.button(intent.button ?? 'left', intent.type === 'down');
                return;
            }
            case 'keyDown':
            case 'keyUp': {
                const code = intent.code || intent.key;
                this.opts.keyboard.key(code, intent.type === 'keyDown', intent.modifiers);
                return;
            }
            case 'scrollSet': {
                const apply = this.opts.applyScrollSet;
                if (!apply) {
                    this.reject('scroll_set_unavailable', 'virtual_apply');
                    return;
                }
                const r = await apply({
                    contextId: intent.contextId,
                    nodeId: intent.nodeId,
                    scrollX: intent.scrollX,
                    scrollY: intent.scrollY,
                });
                if (!r.ok) {
                    this.reject(r.error ? `apply_scroll_failed:${r.error}` : 'apply_scroll_failed', 'virtual_apply');
                }
                return;
            }
            case 'setFiles':
                // D-UI-01b deferred — fine contract stub
                return;
        }
    }
    validatePointer(intent) {
        const active = this.opts.activeViewport();
        if (intent.viewportW !== active.w || intent.viewportH !== active.h) {
            this.reject('stale_viewport', 'validate');
            return false;
        }
        if (intent.x < 0 || intent.y < 0 || intent.x >= intent.viewportW || intent.y >= intent.viewportH) {
            this.reject('invalid_coords', 'validate');
            return false;
        }
        return true;
    }
    reject(errorCode, phase) {
        this.opts.onReject?.(errorCode, phase);
    }
}
exports.EventApplier = EventApplier;
//# sourceMappingURL=EventApplier.js.map