"use strict";
/**
 * V4 Virtual node resolve — maps (contextId, nodeId) to a live Element in the producer realm.
 * Input plane only; does not modify the projection algorithm.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findFrameForContext = findFrameForContext;
exports.createVirtualTargetResolver = createVirtualTargetResolver;
const frame_1 = require("@speculum/page-projection/core/frame");
function resolveTargetExpr(contextId, targetId) {
    const argsJson = JSON.stringify({ contextId, id: targetId });
    return `((args) => {
    const p = globalThis.__speculumProjection;
    if (!p || p.contextId !== args.contextId) return null;
    return p.domNodes.get(args.id) ?? null;
  })(${argsJson})`;
}
async function frameContextId(frame) {
    try {
        return await frame.evaluate(() => {
            const p = globalThis.__speculumProjection;
            return typeof p?.contextId === 'number' ? p.contextId : null;
        });
    }
    catch {
        return null;
    }
}
async function findFrameForContext(page, contextId) {
    if (contextId === frame_1.CONTEXT_ID_ROOT)
        return page.mainFrame();
    for (let attempt = 0; attempt < 120; attempt++) {
        for (const frame of page.frames()) {
            const id = await frameContextId(frame);
            if (id === contextId)
                return frame;
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    return null;
}
function createVirtualTargetResolver(page) {
    return {
        async resolve(targetId, contextId) {
            if (targetId <= 0)
                return null;
            for (let attempt = 0; attempt < 3; attempt++) {
                const frame = await findFrameForContext(page, contextId);
                const frames = frame ? [frame] : page.frames();
                for (const f of frames) {
                    try {
                        const handle = await f.evaluateHandle(resolveTargetExpr(contextId, targetId));
                        const element = handle.asElement();
                        if (element)
                            return element;
                        await handle.dispose().catch(() => undefined);
                    }
                    catch {
                        /* detached */
                    }
                }
                await new Promise((r) => setTimeout(r, 16 * (attempt + 1)));
            }
            return null;
        },
    };
}
//# sourceMappingURL=resolveVirtualNode.js.map