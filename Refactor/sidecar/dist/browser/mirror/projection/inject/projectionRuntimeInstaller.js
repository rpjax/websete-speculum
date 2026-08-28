"use strict";
/**
 * CDP-only projection runtime installer — one bundle per target via
 * Page.addScriptToEvaluateOnNewDocument (+ late frame.evaluate when needed).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectionRuntimeInstaller = void 0;
const buildProjectionInjectBundle_1 = require("./buildProjectionInjectBundle");
const frameCdpSession_1 = require("../session/frameCdpSession");
const HAS_PROJECTION_PROBE = '() => !!(globalThis.__speculumProjection || globalThis.__speculumProjectionBoot)';
class ProjectionRuntimeInstaller {
    context;
    page;
    rootCdp;
    config;
    launchScripts;
    includeCspDiag;
    frameState = (0, frameCdpSession_1.createFrameCdpAttachState)();
    registeredSessions = new WeakSet();
    constructor(opts) {
        this.context = opts.context;
        this.page = opts.page;
        this.rootCdp = opts.rootCdp;
        this.config = opts.config;
        this.launchScripts = opts.launchScripts;
        this.includeCspDiag = opts.includeCspDiag ?? false;
    }
    buildFrameBundle(_frameUrl) {
        return (0, buildProjectionInjectBundle_1.buildProjectionInjectBundle)({
            config: this.config,
            launchScripts: this.launchScripts,
            includeCspDiag: this.includeCspDiag,
        });
    }
    async registerOnCdpSession(session, source) {
        if (this.registeredSessions.has(session))
            return;
        await session.send('Page.addScriptToEvaluateOnNewDocument', { source });
        this.registeredSessions.add(session);
    }
    async lateBootIfNeeded(frame, source) {
        try {
            const url = frame.url();
            if (!url || url === 'about:blank')
                return;
            const hasProjection = await frame.evaluate(HAS_PROJECTION_PROBE);
            if (hasProjection)
                return;
            await frame.evaluate(source);
        }
        catch {
            /* detached / sandboxed without scripts */
        }
    }
    async onFrameSession(frame, session) {
        const bundle = this.buildFrameBundle(frame.url());
        await this.registerOnCdpSession(session, bundle);
        await this.lateBootIfNeeded(frame, bundle);
    }
    async install() {
        const mainBundle = this.buildFrameBundle(this.page.mainFrame().url());
        await this.registerOnCdpSession(this.rootCdp, mainBundle);
        await this.lateBootIfNeeded(this.page.mainFrame(), mainBundle);
        await (0, frameCdpSession_1.wireFrameCdpLifecycle)({
            page: this.page,
            context: this.context,
            state: this.frameState,
            onFrameSession: async (frame) => {
                const session = await (0, frameCdpSession_1.attachFrameCdp)(frame, this.page, this.context, this.frameState);
                if (session)
                    await this.onFrameSession(frame, session);
            },
            onMainFrameNavigated: async () => {
                const bundle = this.buildFrameBundle(this.page.mainFrame().url());
                await this.registerOnCdpSession(this.rootCdp, bundle);
                await this.lateBootIfNeeded(this.page.mainFrame(), bundle);
            },
        });
    }
    /** @internal Test hook — attach inject to a child frame CDP session. */
    async attachFrameForTest(frame) {
        const session = await (0, frameCdpSession_1.attachFrameCdp)(frame, this.page, this.context, this.frameState);
        if (session)
            await this.onFrameSession(frame, session);
    }
}
exports.ProjectionRuntimeInstaller = ProjectionRuntimeInstaller;
//# sourceMappingURL=projectionRuntimeInstaller.js.map