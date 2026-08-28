"use strict";
/**
 * Shared per-frame CDP session attach (OOPIF / nested browsing contexts).
 * Used by CSP Document Response hook and projection runtime installer.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFrameCdpAttachState = createFrameCdpAttachState;
exports.attachFrameCdp = attachFrameCdp;
exports.wireFrameCdpLifecycle = wireFrameCdpLifecycle;
function createFrameCdpAttachState() {
    return { frameSessions: new WeakMap() };
}
/**
 * Attach a CDP session to a child frame (skips main frame).
 * Idempotent per frame — returns existing session when already attached.
 */
async function attachFrameCdp(frame, page, context, state) {
    if (frame === page.mainFrame())
        return null;
    const existing = state.frameSessions.get(frame);
    if (existing)
        return existing;
    try {
        const frameCdp = await context.newCDPSession(frame);
        state.frameSessions.set(frame, frameCdp);
        return frameCdp;
    }
    catch {
        /* same-process iframe / detached — page session may already see its network */
        return null;
    }
}
/** Wire frameattached / framenavigated for OOPIF re-bind. Awaits initial frame attach round. */
async function wireFrameCdpLifecycle(opts) {
    const { page, context, state, onFrameSession, onMainFrameNavigated } = opts;
    const attach = async (frame) => {
        if (onFrameSession) {
            await onFrameSession(frame);
            return;
        }
        await attachFrameCdp(frame, page, context, state);
    };
    await Promise.all(page.frames().map((frame) => attach(frame)));
    page.on('frameattached', (frame) => {
        void attach(frame);
    });
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
            if (onMainFrameNavigated)
                void onMainFrameNavigated();
            return;
        }
        if (state.frameSessions.has(frame))
            return;
        void attach(frame);
    });
}
//# sourceMappingURL=frameCdpSession.js.map