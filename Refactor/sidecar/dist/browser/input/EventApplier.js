"use strict";
/**
 * Serial EventApplier — routes unified intents (§10.5).
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
                if (!this.validatePointer(intent))
                    return;
                this.opts.pointer.moveTo(intent.x, intent.y);
                return;
            case 'down':
            case 'up': {
                if (!this.validatePointer(intent))
                    return;
                if (this.opts.isPageProjection()) {
                    if (!intent.census) {
                        this.reject('missing_census', 'validate');
                        return;
                    }
                    const phaseA = await this.opts.applyScrollCensus?.(intent.census);
                    if (!phaseA?.ok) {
                        this.reject('apply_scroll_failed', 'virtual_apply');
                        return;
                    }
                }
                this.opts.pointer.moveTo(intent.x, intent.y);
                this.opts.pointer.button(intent.button ?? 'left', intent.type === 'down');
                return;
            }
            case 'keyDown':
            case 'keyUp':
                this.opts.keyboard.key(intent.code, intent.type === 'keyDown', intent.modifiers);
                return;
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
                if (!r.ok)
                    this.reject('apply_scroll_failed', 'virtual_apply');
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