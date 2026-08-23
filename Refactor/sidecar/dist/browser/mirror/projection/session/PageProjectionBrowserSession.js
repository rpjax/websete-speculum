"use strict";
/**
 * PageProjectionBrowserSession (sealed contract) — Patchright Chromium + in-page producer + owned data plane.
 *
 * Implements sealed IPageProjectionBrowserSession; temporary file path until Live flip (`docs/page-projection/spec/roadmap.md` CUTOVER-SESSION). Replaces
 * Sealed Live path — replace any leftover Patchright video dual path; do not revive DomMap.
 * Must grow to the **full** `BrowserSession` contract (input, cookies, eval, resize,
 * permissions, probes, …) as V4 work, not by preserving legado. Lab-incomplete is not
 * a cutover license.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PageProjectionBrowserSession = void 0;
exports.createPageProjectionBrowserSessionFactory = createPageProjectionBrowserSessionFactory;
const patchright_1 = require("patchright");
const buildConfigPreScript_1 = require("../inject/buildConfigPreScript");
const loadInpageScript_1 = require("../inject/loadInpageScript");
const snapshotEvaluate_1 = require("./snapshotEvaluate");
const telemetry_1 = require("@speculum/page-projection/core/telemetry");
const plane_1 = require("@speculum/page-projection/core/plane");
const decode_1 = require("@speculum/page-projection/core/decode");
const projectionDataPlaneHost_1 = require("./projectionDataPlaneHost");
const cdpBindingDataPlaneHost_1 = require("./cdpBindingDataPlaneHost");
const documentResponseHook_1 = require("./csp/documentResponseHook");
const scriptInjectMutator_1 = require("./csp/scriptInjectMutator");
const pageProjectionInputDispatch_1 = require("../input/pageProjectionInputDispatch");
const EditableFocus_1 = require("../../../patchright/EditableFocus");
const Navigation_1 = require("../../../patchright/Navigation");
const device_emulation_1 = require("../../../patchright/device-emulation");
const viewport_bounds_1 = require("../../../patchright/viewport-bounds");
function chromeArgs() {
    return [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--no-first-run',
        '--no-default-browser-check',
    ];
}
class PageProjectionBrowserSession {
    sessionId;
    events;
    open = false;
    width = 1280;
    height = 720;
    viewportPolicy = null;
    device = (0, device_emulation_1.resolveDeviceProfile)(null);
    resizing = false;
    url = 'about:blank';
    launchOpts = null;
    browser = null;
    context = null;
    page = null;
    cdpSession = null;
    generation = 1;
    cpuAllowed = false;
    cpuRunning = false;
    inputDispatch = null;
    editableFocus;
    dataPlane = new projectionDataPlaneHost_1.ProjectionDataPlaneHost();
    cdpPlane = new cdpBindingDataPlaneHost_1.CdpBindingDataPlaneHost();
    dataPlaneMode = 'cdp';
    headless;
    probes;
    constructor(sessionId, events, factoryOpts) {
        this.sessionId = sessionId;
        this.events = events;
        this.headless = factoryOpts.headless;
        this.probes = factoryOpts.probes ?? {};
        this.editableFocus = new EditableFocus_1.EditableFocus(events);
        const onPlane = (channel, payload) => {
            if (channel === plane_1.PlaneChannel.Frame) {
                const header = (0, decode_1.peekFrameHeader)(payload);
                this.events.onPageProjectionFrame?.({
                    sequence: header?.sequence ?? 0,
                    generation: header?.generation ?? 0,
                    plane: '',
                    operation: '',
                    timestampMs: Date.now(),
                    body: payload,
                    contextId: 1,
                });
                return;
            }
            if (channel === plane_1.PlaneChannel.Telemetry) {
                let parsed;
                try {
                    parsed = JSON.parse(new TextDecoder().decode(payload));
                }
                catch {
                    return;
                }
                if (!(0, telemetry_1.isProjectionTelemetryMessage)(parsed))
                    return;
                this.events.onPageProjectionTelemetry?.(parsed);
            }
        };
        this.dataPlane.dataPlane.setHandler(onPlane);
        this.cdpPlane.setHandler(onPlane);
    }
    async launch(options) {
        this.launchOpts = options;
        this.width = options.width;
        this.height = options.height;
        this.viewportPolicy = options.viewportPolicy;
        this.device = (0, device_emulation_1.resolveDeviceProfile)(options.device);
        this.cpuAllowed = options.cpuProfiling === true;
        this.dataPlaneMode = options.projectionDataPlane === 'loopback' ? 'loopback' : 'cdp';
        if (options.mirrorMode !== 'pageProjection') {
            throw new Error('PageProjectionBrowserSession requires mirrorMode pageProjection');
        }
        (0, loadInpageScript_1.loadInpageScript)();
        if (this.dataPlaneMode === 'loopback') {
            await this.dataPlane.listen();
        }
        const browser = await patchright_1.chromium.launch({ headless: this.headless, args: chromeArgs() });
        this.browser = browser;
        this.context = await browser.newContext({
            viewport: { width: this.width, height: this.height },
            locale: options.locale || undefined,
            timezoneId: options.timeZoneId || undefined,
            colorScheme: options.colorScheme === 'no-preference' ? undefined : options.colorScheme,
            geolocation: options.geolocation
                ? {
                    latitude: options.geolocation.latitude,
                    longitude: options.geolocation.longitude,
                    accuracy: options.geolocation.accuracy,
                }
                : undefined,
            userAgent: options.device?.userAgentProfile || undefined,
        });
        if (this.dataPlaneMode === 'cdp') {
            await this.cdpPlane.attach(this.context);
        }
        browser.on('disconnected', () => {
            if (!this.open)
                return;
            this.open = false;
            this.events.onCrash({
                errorCode: 'browser_disconnected',
                phase: 'runtime',
                message: 'chromium disconnected',
            });
        });
        this.generation = 1;
        this.open = true;
        this.events.onLocationChanged(this.url);
        return { width: this.width, height: this.height };
    }
    async stop() {
        this.editableFocus.stop();
        this.open = false;
        this.cdpSession = null;
        this.inputDispatch = null;
        const browser = this.browser;
        this.browser = null;
        this.context = null;
        this.page = null;
        if (browser)
            await browser.close();
        this.cdpPlane.close();
        await this.dataPlane.close();
    }
    async dispose() {
        await this.stop();
    }
    async getStatus() {
        return {
            isOpen: this.open,
            tabCount: this.open ? 1 : 0,
            url: this.url,
            resizing: this.resizing,
            width: this.width,
            height: this.height,
            displayWidth: 0,
            displayHeight: 0,
            chromeWidth: this.open ? this.width : 0,
            chromeHeight: this.open ? this.height : 0,
        };
    }
    async restoreState(state) {
        const cookies = state.cookies ?? [];
        const total = cookies.length;
        if (!this.context || total === 0) {
            return { total, skipped: total, normalized: 0, applied: 0, failedIndividual: 0 };
        }
        let applied = 0;
        let failed = 0;
        for (const c of cookies) {
            try {
                await this.context.addCookies([
                    {
                        name: c.name,
                        value: c.value,
                        domain: c.domain,
                        path: c.path || '/',
                        expires: c.expires,
                        httpOnly: c.httpOnly,
                        secure: c.secure,
                        sameSite: c.sameSite ?? 'Lax',
                    },
                ]);
                applied += 1;
            }
            catch {
                failed += 1;
            }
        }
        return { total, skipped: 0, normalized: applied + failed, applied, failedIndividual: failed };
    }
    async exportState() {
        if (!this.context) {
            return { cookies: [], localStorage: [], idbRecords: [], history: [] };
        }
        const raw = await this.context.cookies();
        return {
            cookies: raw.map((c) => ({
                name: c.name,
                value: c.value,
                domain: c.domain,
                path: c.path,
                expires: c.expires,
                httpOnly: c.httpOnly,
                secure: c.secure,
                sameSite: c.sameSite,
            })),
            localStorage: [],
            idbRecords: [],
            history: [],
        };
    }
    async navigate(url) {
        const opts = this.requireLaunch();
        const dataPlaneUrl = this.dataPlane.listenUrl;
        if (this.page) {
            this.generation += 1;
            this.inputDispatch = null;
            await this.page.close();
            this.cdpSession = null;
        }
        this.page = await this.freshPage(dataPlaneUrl, opts);
        this.inputDispatch = new pageProjectionInputDispatch_1.PageProjectionInputDispatch(this.page);
        const allowed = opts.allowedNavigationDomains;
        if (allowed && allowed.length > 0) {
            try {
                const host = new URL(url).hostname;
                if (!(0, Navigation_1.matchesAllowedDomain)(host, allowed)) {
                    this.events.onMainFrameNavigationBlocked(url);
                    throw Object.assign(new Error(`navigation blocked: ${host}`), {
                        code: 'PERMISSION_DENIED',
                        errorCode: 'navigation_blocked',
                        phase: 'navigate',
                    });
                }
            }
            catch (err) {
                if (err.errorCode === 'navigation_blocked')
                    throw err;
            }
        }
        this.editableFocus.stop();
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        this.url = this.page.url() || url;
        this.events.onLocationChanged(this.url);
        this.editableFocus.rebind(this.page);
        this.editableFocus.start(this.page);
    }
    async refresh() {
        if (this.url && this.url !== 'about:blank')
            await this.navigate(this.url);
    }
    async goBack() {
        const page = this.page;
        if (!page)
            return;
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
        this.url = page.url();
        this.events.onLocationChanged(this.url);
    }
    async goForward() {
        const page = this.page;
        if (!page)
            return;
        await page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
        this.url = page.url();
        this.events.onLocationChanged(this.url);
    }
    async resize(request) {
        if (!this.open || !this.viewportPolicy) {
            return {
                ok: false,
                width: this.width,
                height: this.height,
                errorCode: 'session_not_open',
                phase: 'validate',
                message: 'session not open',
            };
        }
        const validated = (0, viewport_bounds_1.validateResizeViewport)(request.width, request.height, this.viewportPolicy);
        if (!validated.ok) {
            return {
                ok: false,
                width: this.width,
                height: this.height,
                errorCode: validated.errorCode,
                phase: 'validate',
                message: validated.message,
            };
        }
        const nextW = validated.width;
        const nextH = validated.height;
        const nextDevice = (0, device_emulation_1.resolveDeviceProfile)(request.device ?? this.device);
        if (nextW === this.width
            && nextH === this.height
            && (0, device_emulation_1.deviceProfilesEqual)(this.device, nextDevice)
            && !this.resizing) {
            return {
                ok: true,
                width: nextW,
                height: nextH,
                chromeWidth: nextW,
                chromeHeight: nextH,
            };
        }
        if (this.resizing) {
            return {
                ok: false,
                width: this.width,
                height: this.height,
                errorCode: 'resize_busy',
                phase: 'validate',
                message: 'another resize is in progress',
            };
        }
        this.resizing = true;
        const previous = { width: this.width, height: this.height, device: this.device };
        try {
            // No page yet (launch before first navigate) — store only; prove on first page.
            if (!this.page || !this.context) {
                this.width = nextW;
                this.height = nextH;
                this.device = nextDevice;
                return {
                    ok: true,
                    width: nextW,
                    height: nextH,
                    chromeWidth: nextW,
                    chromeHeight: nextH,
                };
            }
            await this.page.setViewportSize({ width: nextW, height: nextH });
            const cdp = await this.ensureCdp();
            try {
                const proven = await (0, device_emulation_1.proveLogicalViewport)(cdp, nextW, nextH, nextDevice, {
                    phase: 'resize_apply',
                    context: this.context,
                });
                this.width = proven.width;
                this.height = proven.height;
                this.device = proven.device;
            }
            catch (err) {
                // Soft accept after setViewportSize when prove fails on live pages without
                // viewport-meta (same trap as launch). Hard-fail only for other errors.
                if (err.errorCode !== 'viewport_unproven') {
                    throw err;
                }
                this.width = nextW;
                this.height = nextH;
                this.device = nextDevice;
            }
            return {
                ok: true,
                width: this.width,
                height: this.height,
                chromeWidth: this.width,
                chromeHeight: this.height,
            };
        }
        catch (err) {
            this.width = previous.width;
            this.height = previous.height;
            this.device = previous.device;
            try {
                await this.page?.setViewportSize({ width: previous.width, height: previous.height });
            }
            catch {
                /* best-effort rollback */
            }
            const code = err.errorCode ?? 'resize_failed';
            const phase = err.phase ?? 'resize_apply';
            return {
                ok: false,
                width: this.width,
                height: this.height,
                errorCode: code,
                phase,
                message: err instanceof Error ? err.message : String(err),
            };
        }
        finally {
            this.resizing = false;
        }
    }
    async probe(request) {
        const data = {};
        for (const op of request.ops ?? []) {
            if (op === 'tabs') {
                data.tabs = [{ url: this.url, active: true }];
            }
            else if (op === 'cookies') {
                data.cookies = this.context ? await this.context.cookies() : [];
            }
            else if (op === 'evaluate' && request.evaluateExpression) {
                const r = await this.evaluate(request.evaluateExpression);
                data.evaluate = r;
            }
            else if (op === 'dom' && request.domSelector && this.page) {
                data.dom = await this.page.evaluate(`(sel) => { const el = document.querySelector(sel); return el ? el.outerHTML.slice(0, 8000) : null; }`, request.domSelector);
            }
        }
        return { ok: true, data };
    }
    async evaluate(code) {
        try {
            const value = await this.requirePage().evaluate(code);
            return { ok: true, value: typeof value === 'string' ? value : JSON.stringify(value) };
        }
        catch (err) {
            return { ok: false, value: '', errorMessage: err instanceof Error ? err.message : String(err) };
        }
    }
    async pushInput(input) {
        if (!this.open || !this.page) {
            throw Object.assign(new Error('PageProjectionBrowserSession: session not live'), {
                code: 'FAILED_PRECONDITION',
                errorCode: 'session_not_live',
                phase: 'input',
            });
        }
        if (!this.inputDispatch) {
            throw Object.assign(new Error('PageProjection input dispatch not ready'), {
                code: 'FAILED_PRECONDITION',
                errorCode: 'input_dispatch_missing',
                phase: 'input',
            });
        }
        return this.inputDispatch.dispatchIngress(input);
    }
    getInputPipelineMetrics() {
        return this.inputDispatch?.getPipelineMetrics() ?? null;
    }
    async resolveAndClickDomInput(selector, contextId = 1) {
        if (!this.inputDispatch) {
            return { status: 'dropped', reason: 'input_dispatch_missing' };
        }
        return this.inputDispatch.resolveAndClick(selector, contextId);
    }
    async resolveAndTypeDomInput(selector, value, contextId = 1) {
        if (!this.inputDispatch) {
            return { status: 'dropped', reason: 'input_dispatch_missing' };
        }
        return this.inputDispatch.resolveAndType(selector, value, contextId);
    }
    async resolveAndScrollElementDomInput(selector, scrollTop, contextId = 1) {
        if (!this.inputDispatch) {
            return { status: 'dropped', reason: 'input_dispatch_missing' };
        }
        return this.inputDispatch.resolveAndScrollElement(selector, scrollTop, contextId);
    }
    async resolveAndScrollViewportDomInput(scrollY, scrollX = 0, contextId = 1) {
        if (!this.inputDispatch) {
            return { status: 'dropped', reason: 'input_dispatch_missing' };
        }
        return this.inputDispatch.resolveAndScrollViewport(scrollY, scrollX, contextId);
    }
    async pushCameraFrame(_frame) { }
    async pushMicrophoneAudio(_chunk) { }
    async haltClocks() {
        return this.callProducer(`(() => {
        const p = globalThis.__speculumProjection;
        if (!p || typeof p.haltWorld !== 'function') return { ok: false, reason: 'producer missing' };
        p.haltWorld();
        return { ok: true };
      })()`);
    }
    async resumeClocks() {
        return this.callProducer(`(() => {
        const p = globalThis.__speculumProjection;
        if (!p || typeof p.resumeWorld !== 'function') return { ok: false, reason: 'producer missing' };
        p.resumeWorld();
        return { ok: true };
      })()`);
    }
    async emitFrame(_contextId) {
        return this.callProducer(`(() => {
        const p = globalThis.__speculumProjection;
        if (!p || typeof p.flushFrame !== 'function') return { ok: false, reason: 'producer missing' };
        const r = p.flushFrame();
        return { ok: true, generation: r.generation, sequence: r.sequence };
      })()`);
    }
    async getStateSnapshot(contextId = 1, opts) {
        const single = await this.snapshotContext(contextId, {
            includeTree: opts?.tree === true,
            cssom: opts?.cssom ?? 'none',
        });
        if (!single.ok)
            return { ok: false, reason: single.reason, contextId };
        const v = single.value;
        const result = {
            ok: true,
            contextId,
            generation: v.generation,
            sequence: v.sequence,
            table: opts?.table === 'full' ? { digest: v.table, rows: v.o2 ?? null } : v.table,
            liveChildOrder: opts?.liveChildOrder === true
                ? {
                    childrenByParent: Array.isArray(v.o2?.childrenByParent)
                        ? v.o2.childrenByParent
                        : [],
                }
                : null,
            cssom: opts?.cssom && opts.cssom !== 'none'
                ? {
                    mode: opts.cssom,
                    table: { sheets: null, rules: null },
                    live: { sheets: v.cssomO2 ?? null },
                }
                : null,
            tree: opts?.tree === true ? (v.tree ?? null) : null,
            formProps: opts?.formProps === true ? (v.formProps ?? []) : null,
            frameNewNodes: opts?.frameNewNodes === true && v.nodeNewConnected
                ? v.nodeNewConnected.disconnectedIds.map((nodeId) => ({ nodeId, connected: false }))
                : opts?.frameNewNodes === true
                    ? []
                    : null,
        };
        return result;
    }
    async snapshotContext(contextId, opts) {
        try {
            const includeTree = opts?.includeTree !== false;
            const cssom = opts?.cssom ?? 'none';
            const treeScript = includeTree && contextId === 1 ? (0, snapshotEvaluate_1.loadSnapshotScriptForEvaluate)() : '';
            const fn = (0, snapshotEvaluate_1.snapshotContextEvaluateExpression)();
            return (await this.requirePage().evaluate(`(${fn})(${contextId}, ${JSON.stringify({ cssom, includeTree })}, ${JSON.stringify(treeScript)})`));
        }
        catch (err) {
            return { ok: false, reason: err instanceof Error ? err.message : String(err) };
        }
    }
    async startCpuProfile() {
        if (!this.cpuAllowed)
            return { ok: false, reason: 'cpuProfiling disabled at launch' };
        if (this.cpuRunning)
            return { ok: false, reason: 'cpu profile already running' };
        const start = this.probes.startCpuProfile;
        if (!start)
            return { ok: false, reason: 'startCpuProfile probe not registered' };
        const cdp = await this.ensureCdp();
        await start(cdp);
        this.cpuRunning = true;
        return { ok: true };
    }
    async stopCpuProfile() {
        if (!this.cpuRunning)
            return { ok: false, reason: 'cpu profile not running' };
        const stop = this.probes.stopCpuProfile;
        if (!stop)
            return { ok: false, reason: 'stopCpuProfile probe not registered' };
        const cdp = await this.ensureCdp();
        const { raw, summary } = await stop(cdp, 20);
        this.cpuRunning = false;
        return {
            ok: true,
            summary: {
                totalSamples: summary.totalSamples,
                wallMs: summary.wallMs,
                approxCpuMs: summary.approxCpuMs,
                ourCode: { totalPct: summary.ourCode.totalPct, totalMs: summary.ourCode.totalMs },
            },
            profileBytes: new TextEncoder().encode(JSON.stringify(raw)),
        };
    }
    async requestResync(request) {
        this.sendControl({
            type: 'requestResync',
            contextId: request?.contextId ?? 1,
            reason: request?.reason,
        });
    }
    async getTelemetrySnapshot(contextId = 1) {
        return {
            contextId,
            logicalWidth: this.width,
            logicalHeight: this.height,
            chromeWidth: this.width,
            chromeHeight: this.height,
            dataPlaneListening: !!this.dataPlane.listenUrl,
            generation: this.generation,
            sequence: 0,
            producerHalted: false,
            frameQueueDepth: 0,
            inputPendingCount: 0,
        };
    }
    async getAsset(_key, _opts) {
        return null;
    }
    async putUpload(_id, _body, _contentType, _name) { }
    sendControl(message) {
        if (this.dataPlaneMode === 'cdp') {
            const page = this.page;
            if (!page)
                return;
            void this.cdpPlane.sendControl(page, message);
            return;
        }
        this.dataPlane.sendControl(message);
    }
    async freshPage(dataPlaneUrl, options) {
        const context = this.context;
        if (!context)
            throw new Error('context not open');
        const p = await context.newPage();
        p.on('console', (msg) => this.events.onConsole(consoleLevel(msg.type()), msg.text()));
        p.on('pageerror', (err) => this.events.onConsole(3, err.message));
        p.on('crash', () => {
            if (!this.open)
                return;
            this.open = false;
            this.events.onCrash({
                errorCode: 'page_crash',
                phase: 'runtime',
                message: 'chromium page crashed',
            });
        });
        p.on('framenavigated', (frame) => {
            try {
                if (frame !== p.mainFrame())
                    return;
                const u = p.url();
                if (!/^https?:\/\//i.test(u) && u !== 'about:blank')
                    return;
                this.url = u;
                this.events.onLocationChanged(u);
            }
            catch {
                /* */
            }
        });
        p.on('close', () => {
            this.editableFocus.stop();
        });
        const telemetry = (options.projectionTelemetry ?? telemetry_1.LAB_TELEMETRY_DEFAULTS);
        const useLoopback = this.dataPlaneMode === 'loopback';
        const configPre = (0, buildConfigPreScript_1.buildConfigPreScript)({
            transport: useLoopback ? 'loopback' : 'cdp',
            dataPlaneUrl: useLoopback ? dataPlaneUrl : '',
            frameRateHz: options.frameRateHz ?? 60,
            telemetry,
            generation: this.generation,
            cssomPollHz: telemetry.cssomPoll === false ? 0 : 5,
        });
        await p.addInitScript({ content: configPre });
        await p.addInitScript({ content: (0, loadInpageScript_1.loadInpageScript)() });
        // Document Response-stage hook before any navigation — CSP + optional launch scripts.
        // TLS/HTTP stay on Chromium; never fulfill Document from Node-originated bytes.
        this.cdpSession = await context.newCDPSession(p);
        const launchScripts = options.scripts ?? [];
        const storedScripts = launchScripts
            .filter((s) => !s.remoteUrl && s.file && s.content != null)
            .map((s) => ({ file: s.file, content: s.content }));
        await (0, documentResponseHook_1.installDocumentResponseHook)(this.cdpSession, {
            mutators: [documentResponseHook_1.cspDocumentMutator, (0, scriptInjectMutator_1.createScriptInjectMutator)(launchScripts)],
            storedScripts,
        });
        // Lockstep prove — same as video launch/resize (Q14 / PP-SURF-5).
        try {
            await (0, device_emulation_1.proveLogicalViewport)(this.cdpSession, this.width, this.height, this.device, {
                phase: 'launch_apply',
                context,
            });
        }
        catch (err) {
            // Soft: context viewport already set; prove can fail on about:blank before meta.
            // Resize path re-proves with full error surface.
            if (err.errorCode === 'viewport_unproven') {
                /* continue — first paint pages install meta */
            }
            else {
                throw err;
            }
        }
        return p;
    }
    requirePage() {
        if (!this.page)
            throw new Error('PageProjectionBrowserSession: page not open');
        return this.page;
    }
    requireLaunch() {
        if (!this.launchOpts)
            throw new Error('PageProjectionBrowserSession: not launched');
        return this.launchOpts;
    }
    async ensureCdp() {
        if (this.cdpSession)
            return this.cdpSession;
        const context = this.context;
        const page = this.requirePage();
        if (!context)
            throw new Error('context not open');
        this.cdpSession = await context.newCDPSession(page);
        return this.cdpSession;
    }
    async callProducer(expression) {
        try {
            return (await this.requirePage().evaluate(expression));
        }
        catch (err) {
            return { ok: false, reason: err instanceof Error ? err.message : String(err) };
        }
    }
}
exports.PageProjectionBrowserSession = PageProjectionBrowserSession;
function consoleLevel(type) {
    if (type === 'error')
        return 3;
    if (type === 'warning')
        return 2;
    return 1;
}
function createPageProjectionBrowserSessionFactory(opts) {
    return {
        create(sessionId, events) {
            return new PageProjectionBrowserSession(sessionId, events, opts);
        },
    };
}
//# sourceMappingURL=PageProjectionBrowserSession.js.map