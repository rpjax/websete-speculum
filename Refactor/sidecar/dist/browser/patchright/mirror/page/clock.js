"use strict";
/**
 * §5.3.4 / §5.3.5 — the frame boundary clock. `requestAnimationFrame` MUST
 * NOT be used (it is compositor-tied and throttled when hidden); the
 * scheduler is injected so this is a plain `setInterval`/`MessageChannel`
 * style timer in production and a fake, manually-ticked one in unit tests.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameClock = exports.RATE_LADDER = void 0;
/** §5.3.5.1 — 60 → 30 → 15 → 5 Hz degradation ladder. */
exports.RATE_LADDER = [60, 30, 15, 5];
const DEFAULTS = {
    frameRateHz: 60,
    hiddenRateHz: 1,
    rateRecoverMs: 5000,
    frameStallMs: 1000,
};
class FrameClock {
    opts;
    handle = null;
    currentRateHz;
    topRateHz;
    lastTickAtMs;
    lastRecoverAtMs = 0;
    hidden = false;
    constructor(opts) {
        this.opts = opts;
        this.topRateHz = opts.frameRateHz ?? DEFAULTS.frameRateHz;
        this.currentRateHz = this.topRateHz;
        this.lastTickAtMs = opts.scheduler.now();
    }
    get rateHz() {
        return this.currentRateHz;
    }
    get isHidden() {
        return this.hidden;
    }
    start() {
        this.stop();
        this.startInterval(this.currentRateHz);
    }
    stop() {
        if (this.handle !== null) {
            this.opts.scheduler.clearInterval(this.handle);
            this.handle = null;
        }
    }
    /** §5.3.5.3 — a client-hidden report collapses the rate; mutations keep accumulating. */
    setHidden(hidden) {
        this.hidden = hidden;
        if (hidden)
            this.applyRate(this.opts.hiddenRateHz ?? DEFAULTS.hiddenRateHz);
        else
            this.applyRate(this.topRateHz);
    }
    /** §5.3.5.1 — one step down the ladder. Never desyncs; a congested pipe just gets fewer, larger frames. */
    degrade() {
        if (this.hidden)
            return;
        const ladder = this.opts.rateLadder ?? exports.RATE_LADDER;
        const idx = ladder.indexOf(this.currentRateHz);
        const nextIdx = idx === -1 ? 0 : Math.min(idx + 1, ladder.length - 1);
        this.applyRate(ladder[nextIdx]);
    }
    /** §5.3.5.2 — one step up, throttled to at most once per `rateRecoverMs`. Returns whether it stepped. */
    recoverStep() {
        if (this.hidden)
            return false;
        const now = this.opts.scheduler.now();
        const recoverMs = this.opts.rateRecoverMs ?? DEFAULTS.rateRecoverMs;
        if (now - this.lastRecoverAtMs < recoverMs)
            return false;
        const ladder = this.opts.rateLadder ?? exports.RATE_LADDER;
        const idx = ladder.indexOf(this.currentRateHz);
        if (idx <= 0)
            return false;
        this.applyRate(ladder[idx - 1]);
        this.lastRecoverAtMs = now;
        return true;
    }
    /**
     * §5.3.4.4 watchdog — the caller (Node side, which sees page activity even
     * when the in-page clock is starved) polls this. Forces a flush tick and
     * reports the stall when no tick has landed for `frameStallMs`.
     */
    checkStall() {
        const now = this.opts.scheduler.now();
        const stallMs = this.opts.frameStallMs ?? DEFAULTS.frameStallMs;
        const sinceLastTickMs = now - this.lastTickAtMs;
        if (sinceLastTickMs < stallMs)
            return false;
        this.opts.onStall?.({ sinceLastTickMs });
        this.forceTick();
        return true;
    }
    forceTick() {
        this.lastTickAtMs = this.opts.scheduler.now();
        this.opts.onTick();
    }
    startInterval(hz) {
        const intervalMs = 1000 / hz;
        this.handle = this.opts.scheduler.setInterval(() => this.tick(), intervalMs);
    }
    tick() {
        this.lastTickAtMs = this.opts.scheduler.now();
        this.opts.onTick();
    }
    applyRate(hz) {
        if (hz === this.currentRateHz)
            return;
        this.currentRateHz = hz;
        if (this.handle !== null) {
            this.opts.scheduler.clearInterval(this.handle);
            this.startInterval(hz);
        }
    }
}
exports.FrameClock = FrameClock;
//# sourceMappingURL=clock.js.map