"use strict";
/**
 * CDP-only projection runtime installer — one bundle per target via
 * Page.addScriptToEvaluateOnNewDocument (+ late main-world evaluate when needed).
 *
 * Happy path: onNewDocument (Chromium runs it on every new document).
 * lateBoot: miss-detect only — main-world probe (never Patchright isolate), sync
 * inject arm for idempotency, coalesce in-flight work, settle before inject on
 * navigate/frame so onNewDocument wins the race without a 200KB re-eval.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectionRuntimeInstaller = void 0;
const buildProjectionInjectBundle_1 = require("./buildProjectionInjectBundle");
const injectSentinel_1 = require("./injectSentinel");
const frameCdpSession_1 = require("../session/frameCdpSession");
/** Settle before late inject — lets onNewDocument arm the heap first. */
const LATE_BOOT_SETTLE_MS = {
    install: 0,
    navigate: 16,
    frame: 16,
};
const RUNTIME_PRESENT_EXPR = (0, injectSentinel_1.buildInjectRuntimePresentExpression)();
const BOOT_PROBE_DETAIL = `() => ({
  hasProjection: !!globalThis.__speculumProjection,
  hasBootPromise: !!globalThis.__speculumProjectionBoot,
  injectArmed: !!globalThis.${injectSentinel_1.INJECT_ARM_GLOBAL},
  bootId: (globalThis.__speculumBootDiag && globalThis.__speculumBootDiag.bootId) || null,
  href: typeof location !== 'undefined' ? location.href : '',
})`;
const BOOT_LINES_DETAIL = `() => Array.isArray(globalThis.__speculumBootDiagLines) ? globalThis.__speculumBootDiagLines.slice() : []`;
const DIAG_BOOT = process.env.SPECULUM_DIAG_BOOT === '1';
function bootDiagSidecar(event, fields = {}) {
    if (!DIAG_BOOT)
        return;
    const payload = {
        side: 'sidecar',
        event,
        t: Date.now(),
        ...fields,
    };
    process.stderr.write(`[speculum-boot-diag] ${JSON.stringify(payload)}\n`);
}
function sleep(ms) {
    if (ms <= 0)
        return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
}
class ProjectionRuntimeInstaller {
    context;
    page;
    rootCdp;
    config;
    launchScripts;
    includeCspDiag;
    frameState = (0, frameCdpSession_1.createFrameCdpAttachState)();
    registeredSessions = new WeakSet();
    lateBootInflight = new WeakMap();
    /** One late inject attempt per document: `${generation}|${url}` per frame. */
    lateBootAttempts = new WeakMap();
    cachedBundle = null;
    constructor(opts) {
        this.context = opts.context;
        this.page = opts.page;
        this.rootCdp = opts.rootCdp;
        this.config = opts.config;
        this.launchScripts = opts.launchScripts;
        this.includeCspDiag = opts.includeCspDiag ?? false;
    }
    buildFrameBundle(_frameUrl) {
        if (this.cachedBundle === null) {
            this.cachedBundle = (0, buildProjectionInjectBundle_1.buildProjectionInjectBundle)({
                config: this.config,
                launchScripts: this.launchScripts,
                includeCspDiag: this.includeCspDiag,
            });
        }
        return this.cachedBundle;
    }
    async registerOnCdpSession(session, source) {
        if (this.registeredSessions.has(session))
            return;
        await session.send('Page.addScriptToEvaluateOnNewDocument', { source });
        this.registeredSessions.add(session);
    }
    /** CDP session that owns this frame's main world (root or OOPIF). */
    cdpForFrame(frame) {
        if (frame === this.page.mainFrame())
            return this.rootCdp;
        return this.frameState.frameSessions.get(frame) ?? null;
    }
    /**
     * Evaluate an expression in the page/frame **main world** (where Virtual lives).
     * Never use Patchright's default isolated world for product lateBoot decisions.
     */
    async evaluateMainWorldJson(frame, expression, opts) {
        const awaitPromise = opts?.awaitPromise === true;
        const cdp = this.cdpForFrame(frame);
        if (cdp) {
            try {
                const result = (await cdp.send('Runtime.evaluate', {
                    expression,
                    returnByValue: true,
                    awaitPromise,
                }));
                if (result.exceptionDetails) {
                    bootDiagSidecar('lateBoot_cdp_eval_exception', {
                        text: result.exceptionDetails.text ?? 'exception',
                    });
                    return null;
                }
                return (result.result?.value ?? null);
            }
            catch (err) {
                bootDiagSidecar('lateBoot_cdp_eval_error', {
                    message: err instanceof Error ? err.message : String(err),
                });
                return null;
            }
        }
        try {
            const evalWorld = frame.evaluate.bind(frame);
            return (await evalWorld(`() => (${expression})`, undefined, false));
        }
        catch {
            return null;
        }
    }
    /**
     * Run inject bundle in the frame main world.
     * awaitPromise=false: Virtual boots via void(async…); do not block CDP on establish.
     */
    async evaluateMainWorldSource(frame, source) {
        const cdp = this.cdpForFrame(frame);
        if (cdp) {
            const result = (await cdp.send('Runtime.evaluate', {
                expression: source,
                awaitPromise: false,
            }));
            if (result.exceptionDetails) {
                throw new Error(result.exceptionDetails.text ?? 'Runtime.evaluate exception');
            }
            return;
        }
        const evalWorld = frame.evaluate.bind(frame);
        await evalWorld(source, undefined, false);
    }
    async probeRuntimePresent(frame) {
        return this.evaluateMainWorldJson(frame, RUNTIME_PRESENT_EXPR, {
            awaitPromise: false,
        });
    }
    documentAttemptKey(url) {
        const g = this.config.generation ?? 1;
        return `${g}|${url}`;
    }
    hasLateBootAttempt(frame, key) {
        return this.lateBootAttempts.get(frame)?.has(key) ?? false;
    }
    markLateBootAttempt(frame, key) {
        let set = this.lateBootAttempts.get(frame);
        if (!set) {
            set = new Set();
            this.lateBootAttempts.set(frame, set);
        }
        set.add(key);
    }
    lateBootIfNeeded(frame, bundle, caller) {
        const existing = this.lateBootInflight.get(frame);
        if (existing)
            return existing;
        const run = this.lateBootIfNeededImpl(frame, bundle, caller).finally(() => {
            if (this.lateBootInflight.get(frame) === run)
                this.lateBootInflight.delete(frame);
        });
        this.lateBootInflight.set(frame, run);
        return run;
    }
    async lateBootIfNeededImpl(frame, bundle, caller) {
        try {
            const url = frame.url();
            if (!url || url === 'about:blank') {
                bootDiagSidecar('lateBoot_skip', { caller, reason: 'blank_url', url: url || '' });
                return;
            }
            let present = await this.probeRuntimePresent(frame);
            if (DIAG_BOOT) {
                const mainRaw = await this.evaluateMainWorldJson(frame, `(${BOOT_PROBE_DETAIL})()`, { awaitPromise: false });
                bootDiagSidecar('lateBoot_probe', {
                    caller,
                    url,
                    present,
                    mainProbe: mainRaw ? { ...mainRaw, world: 'main' } : null,
                });
            }
            if (present === true) {
                bootDiagSidecar('lateBoot_skip', { caller, reason: 'probe_true', url });
                return;
            }
            if (present === null) {
                // Fail-closed: never inject when main-world probe is unavailable.
                bootDiagSidecar('lateBoot_skip', { caller, reason: 'probe_null', url });
                return;
            }
            const settleMs = LATE_BOOT_SETTLE_MS[caller] ?? 0;
            if (settleMs > 0) {
                await sleep(settleMs);
                present = await this.probeRuntimePresent(frame);
                if (present === true) {
                    bootDiagSidecar('lateBoot_skip', {
                        caller,
                        reason: 'probe_true_after_settle',
                        url,
                        settleMs,
                    });
                    return;
                }
                if (present === null) {
                    bootDiagSidecar('lateBoot_skip', {
                        caller,
                        reason: 'probe_null',
                        url,
                        settleMs,
                    });
                    return;
                }
            }
            const attemptKey = this.documentAttemptKey(url);
            if (this.hasLateBootAttempt(frame, attemptKey)) {
                bootDiagSidecar('lateBoot_skip', {
                    caller,
                    reason: 'already_attempted',
                    url,
                    attemptKey,
                });
                return;
            }
            this.markLateBootAttempt(frame, attemptKey);
            bootDiagSidecar('lateBoot_evaluate', {
                caller,
                url,
                reason: 'probe_false',
                world: 'main',
                settleMs,
                attemptKey,
            });
            await this.evaluateMainWorldSource(frame, bundle);
            if (DIAG_BOOT) {
                const afterRaw = await this.evaluateMainWorldJson(frame, `(${BOOT_PROBE_DETAIL})()`, { awaitPromise: false });
                const mainLineRaw = await this.evaluateMainWorldJson(frame, `(${BOOT_LINES_DETAIL})()`, { awaitPromise: false });
                bootDiagSidecar('lateBoot_evaluate_done', {
                    caller,
                    url,
                    mainAfter: afterRaw ? { ...afterRaw, world: 'main' } : null,
                    mainBootDiagLineCount: Array.isArray(mainLineRaw) ? mainLineRaw.length : 0,
                    mainBootDiagLines: Array.isArray(mainLineRaw) ? mainLineRaw.slice(0, 80) : [],
                });
            }
        }
        catch (err) {
            if (DIAG_BOOT) {
                try {
                    const mainLines = await this.evaluateMainWorldJson(frame, `(${BOOT_LINES_DETAIL})()`, { awaitPromise: false });
                    bootDiagSidecar('lateBoot_error_main_lines', {
                        caller,
                        lineCount: Array.isArray(mainLines) ? mainLines.length : 0,
                        lines: Array.isArray(mainLines) ? mainLines.slice(0, 80) : [],
                    });
                }
                catch {
                    /* */
                }
            }
            bootDiagSidecar('lateBoot_error', {
                caller,
                message: err instanceof Error ? err.message : String(err),
            });
            /* detached / sandboxed without scripts */
        }
    }
    async onFrameSession(frame, session) {
        const bundle = this.buildFrameBundle(frame.url());
        await this.registerOnCdpSession(session, bundle);
        await this.lateBootIfNeeded(frame, bundle, 'frame');
    }
    async install() {
        bootDiagSidecar('installer_config', {
            diagBoot: this.config.diagBoot === true,
            envDiagBoot: process.env.SPECULUM_DIAG_BOOT === '1',
            sessionId: this.config.sessionId ?? null,
            generation: this.config.generation ?? null,
        });
        const mainBundle = this.buildFrameBundle(this.page.mainFrame().url());
        bootDiagSidecar('installer_bundle_has_diagBoot', {
            hasDiagBootLiteral: mainBundle.includes('"diagBoot":true') || mainBundle.includes('"diagBoot": true'),
            hasBootDiagMarker: mainBundle.includes('[speculum-boot-diag]'),
            hasInjectArm: mainBundle.includes(injectSentinel_1.INJECT_ARM_GLOBAL),
        });
        await this.registerOnCdpSession(this.rootCdp, mainBundle);
        await this.lateBootIfNeeded(this.page.mainFrame(), mainBundle, 'install');
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
                await this.lateBootIfNeeded(this.page.mainFrame(), bundle, 'navigate');
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