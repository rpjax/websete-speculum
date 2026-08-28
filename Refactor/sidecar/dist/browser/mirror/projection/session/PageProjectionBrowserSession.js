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
const node_crypto_1 = require("node:crypto");
const inject_1 = require("../inject");
const telemetry_1 = require("@speculum/page-projection/core/telemetry");
const plane_1 = require("@speculum/page-projection/core/plane");
const decode_1 = require("@speculum/page-projection/core/decode");
const projectionDataPlaneHost_1 = require("./projectionDataPlaneHost");
const documentResponseHook_1 = require("./csp/documentResponseHook");
const cspDiag_1 = require("./csp/cspDiag");
const singleTab_1 = require("./singleTab");
const EditableFocus_1 = require("../../../patchright/EditableFocus");
const Navigation_1 = require("../../../patchright/Navigation");
const device_emulation_1 = require("../../../patchright/device-emulation");
const viewport_bounds_1 = require("../../../patchright/viewport-bounds");
const AssetStore_1 = require("../assets/AssetStore");
const rewritePart_1 = require("../assets/rewritePart");
const Display_1 = require("../../../patchright/Display");
const ChromeRuntime_1 = require("../../../patchright/ChromeRuntime");
const createInputAdapter_1 = require("../../../input/createInputAdapter");
const clickDelivery_1 = require("../../../input/clickDelivery");
const SidecarBuffer_1 = require("../../../input/SidecarBuffer");
const EventApplier_1 = require("../../../input/EventApplier");
const ingressToUnifiedIntent_1 = require("../../../input/ingressToUnifiedIntent");
const ppDisplays = new Display_1.DisplayAllocator();
class PageProjectionBrowserSession {
    sessionId;
    events;
    open = false;
    width = 1280;
    height = 720;
    displayWidth = 1280;
    displayHeight = 720;
    viewportPolicy = null;
    device = (0, device_emulation_1.resolveDeviceProfile)(null);
    resizing = false;
    url = 'about:blank';
    launchOpts = null;
    browser = null;
    context = null;
    page = null;
    chrome = null;
    display = null;
    inputAdapter = null;
    eventApplier = null;
    cdpSession = null;
    generation = 1;
    cpuAllowed = false;
    cpuRunning = false;
    editableFocus;
    dataPlane = new projectionDataPlaneHost_1.ProjectionDataPlaneHost();
    assets = new AssetStore_1.AssetStore();
    rewriteHop = new rewritePart_1.FrameRewriteHop();
    probes;
    planeBridgeToken;
    constructor(sessionId, events, factoryOpts) {
        this.sessionId = sessionId;
        this.events = events;
        void factoryOpts.headless;
        this.probes = factoryOpts.probes ?? {};
        this.planeBridgeToken = (0, node_crypto_1.randomUUID)();
        this.editableFocus = new EditableFocus_1.EditableFocus(events);
        const onPlane = (channel, payload) => {
            if (channel === plane_1.PlaneChannel.Frame) {
                const parts = this.rewriteHop.push(payload, {
                    pageUrl: this.url,
                    assets: this.assets,
                });
                for (const body of parts) {
                    const header = (0, decode_1.peekFrameHeader)(body);
                    this.events.onPageProjectionFrame?.({
                        sequence: header?.sequence ?? 0,
                        generation: header?.generation ?? 0,
                        plane: '',
                        operation: '',
                        timestampMs: Date.now(),
                        body,
                        contextId: header?.contextId ?? 1,
                        partIndex: header?.partIndex,
                        partCount: header?.partCount,
                        flags: header?.flags,
                    });
                }
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
    }
    async launch(options) {
        this.launchOpts = options;
        this.width = options.width;
        this.height = options.height;
        this.viewportPolicy = options.viewportPolicy;
        this.device = (0, device_emulation_1.resolveDeviceProfile)(options.device);
        this.cpuAllowed = options.cpuProfiling === true;
        if (options.mirrorMode !== 'pageProjection') {
            throw new Error('PageProjectionBrowserSession requires mirrorMode pageProjection');
        }
        if (options.projectionDataPlane != null && options.projectionDataPlane !== 'loopback') {
            throw Object.assign(new Error('PageProjection data plane is loopback-only (projectionDataPlane must be "loopback")'), { code: 'FAILED_PRECONDITION', errorCode: 'data_plane_not_loopback', phase: 'launch' });
        }
        if (!process.env['CHROME_EXECUTABLE']?.trim()) {
            throw Object.assign(new Error('CHROME_EXECUTABLE required for PageProjection Display launch'), {
                code: 'FAILED_PRECONDITION',
                errorCode: 'chrome_executable_missing',
                phase: 'launch',
            });
        }
        (0, inject_1.loadInpageScript)();
        await this.dataPlane.listen();
        this.dataPlane.configureSession(this.sessionId, this.generation);
        // Display capacity = policy max R; logical viewport soft-resizes within R (D-UI-05/11).
        // Sparse-cdp is the sole PP input path (OS ABS removed — decision-log.md 2026-08-27).
        // cdp.send is a lazy accessor through currentCdpSession(); safe to build before Chrome exists.
        const maxW = options.viewportPolicy.maxWidth;
        const maxH = options.viewportPolicy.maxHeight;
        this.displayWidth = maxW;
        this.displayHeight = maxH;
        const inputAdapter = (0, createInputAdapter_1.createInputAdapter)('sparse-cdp', {
            cdp: { send: (method, params) => this.currentCdpSession().send(method, params) },
            keyboard: {
                down: (key) => this.requirePage().keyboard.down(key),
                up: (key) => this.requirePage().keyboard.up(key),
            },
            logicalWidth: options.width,
            logicalHeight: options.height,
        });
        this.inputAdapter = inputAdapter;
        const displayNum = ppDisplays.allocate();
        this.display = await Display_1.Display.start(displayNum, maxW, maxH);
        this.chrome = await (0, ChromeRuntime_1.launchChrome)({
            sessionId: this.sessionId,
            displayEnv: this.display.displayEnv,
            width: this.width,
            height: this.height,
            locale: options.locale || 'en-US',
            language: options.language || options.locale || 'en-US',
            timeZoneId: options.timeZoneId || 'UTC',
            colorScheme: options.colorScheme === 'no-preference' ? 'light' : options.colorScheme || 'light',
            geolocation: options.geolocation,
            device: options.device,
        });
        this.context = this.chrome.context;
        this.page = this.chrome.page;
        this.cdpSession = this.chrome.cdp;
        this.browser = this.context.browser();
        this.eventApplier = new EventApplier_1.EventApplier({
            buffer: new SidecarBuffer_1.SidecarBuffer(),
            pointer: inputAdapter.pointer,
            keyboard: inputAdapter.keyboard,
            activeViewport: () => ({ w: this.width, h: this.height }),
            clickDelivery: (0, clickDelivery_1.liveNodeResolveClickDelivery)((contextId, nodeId, x, y) => this.resolveClickTarget(contextId, nodeId, x, y)),
            applyScrollSet: (args) => this.applyScrollSet(args),
            applyHistoryNav: async (direction) => {
                try {
                    if (direction === 'back')
                        await this.goBack();
                    else
                        await this.goForward();
                    return { ok: true };
                }
                catch (err) {
                    return {
                        ok: false,
                        error: err instanceof Error ? err.message : String(err),
                    };
                }
            },
            onReject: (errorCode, phase) => {
                this.events.onConsole(3, `input_reject ${errorCode} ${phase}`);
            },
        });
        this.context.on('close', () => {
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
        this.eventApplier = null;
        this.assets.bindPage(null);
        this.assets.clear();
        this.rewriteHop.reset();
        const chrome = this.chrome;
        this.chrome = null;
        this.browser = null;
        this.context = null;
        this.page = null;
        if (chrome)
            await (0, ChromeRuntime_1.closeChrome)(chrome);
        const display = this.display;
        this.display = null;
        if (display)
            await display.dispose();
        const inputAdapter = this.inputAdapter;
        this.inputAdapter = null;
        inputAdapter?.dispose();
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
            displayWidth: this.displayWidth,
            displayHeight: this.displayHeight,
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
        // Do not close the live page before freshPage — see freshPage ordering.
        this.generation += 1;
        this.cdpSession = null;
        this.dataPlane.configureSession(this.sessionId, this.generation);
        this.page = await this.freshPage(dataPlaneUrl, opts);
        this.assets.clear();
        this.assets.bindPage(this.page);
        this.rewriteHop.reset();
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
        await this.dataPlane.waitEstablished({ generation: this.generation });
        this.url = this.page.url() || url;
        this.events.onLocationChanged(this.url);
        (0, cspDiag_1.cspDiagLog)('navigate complete', {
            url: this.url,
            dataPlaneEstablished: this.dataPlane.isEstablished,
            generation: this.generation,
        });
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
                displayWidth: this.displayWidth,
                displayHeight: this.displayHeight,
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
                this.inputAdapter?.setLogicalSize(nextW, nextH);
                return {
                    ok: true,
                    width: nextW,
                    height: nextH,
                    chromeWidth: nextW,
                    chromeHeight: nextH,
                    displayWidth: this.displayWidth,
                    displayHeight: this.displayHeight,
                };
            }
            const cdp = await this.ensureCdp();
            try {
                const proven = await (0, device_emulation_1.proveLogicalViewport)(cdp, nextW, nextH, nextDevice, {
                    phase: 'resize_apply',
                    context: this.context,
                });
                this.width = proven.width;
                this.height = proven.height;
                this.device = proven.device;
                this.inputAdapter?.setLogicalSize(this.width, this.height);
            }
            catch (err) {
                // Soft accept when prove fails on live pages without viewport-meta (same as launch).
                if (err.errorCode !== 'viewport_unproven') {
                    throw err;
                }
                this.width = nextW;
                this.height = nextH;
                this.device = nextDevice;
                this.inputAdapter?.setLogicalSize(this.width, this.height);
            }
            return {
                ok: true,
                width: this.width,
                height: this.height,
                chromeWidth: this.width,
                chromeHeight: this.height,
                displayWidth: this.displayWidth,
                displayHeight: this.displayHeight,
            };
        }
        catch (err) {
            this.width = previous.width;
            this.height = previous.height;
            this.device = previous.device;
            this.inputAdapter?.setLogicalSize(previous.width, previous.height);
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
            // Patchright isolated world — DOM OK; Virtual producer globals are NOT visible here.
            // Producer RPC = loopback invoke (§10.1c), not CDP Runtime.evaluate.
            const page = this.requirePage();
            const value = await page.evaluate(code);
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
        if (!this.eventApplier) {
            throw Object.assign(new Error('PageProjection EventApplier not ready'), {
                code: 'FAILED_PRECONDITION',
                errorCode: 'input_applier_missing',
                phase: 'input',
            });
        }
        const intent = (0, ingressToUnifiedIntent_1.ingressToUnifiedIntent)(input);
        if (!intent) {
            return { status: 'dropped', reason: 'unsupported_intent' };
        }
        this.eventApplier.enqueue(intent);
        return { status: 'dispatched' };
    }
    getInputPipelineMetrics() {
        return null;
    }
    /** Lab/dossier label — sparse-cdp is the sole PP input path. */
    getInputBackend() {
        return 'cdp';
    }
    /**
     * Lab/CLI blueprint helper — id-addressed click via Virtual `resolveNodeHit`.
     * Enqueues onto the same `EventApplier` as `pushInput`.
     */
    async resolveAndClickDomInputByNodeId(selector, contextId = 1) {
        if (!this.eventApplier) {
            return { status: 'dropped', reason: 'input_applier_missing' };
        }
        const keyed = await this.loopbackInvoke('keyOfSelector', { selector, contextId });
        if (!keyed.ok || typeof keyed.nodeId !== 'number' || keyed.nodeId <= 0) {
            return { status: 'dropped', reason: keyed.reason ?? 'selector_miss' };
        }
        const hit = await this.loopbackInvoke('resolveNodeHit', { contextId, nodeId: keyed.nodeId });
        if (!hit.ok || typeof hit.x !== 'number' || typeof hit.y !== 'number') {
            return { status: 'dropped', reason: hit.reason ?? 'resolve_hit_failed' };
        }
        const base = {
            schemaVersion: 1,
            viewportW: this.width,
            viewportH: this.height,
            x: hit.x,
            y: hit.y,
            button: 'left',
            contextId,
            nodeId: keyed.nodeId,
        };
        this.eventApplier.enqueue({ ...base, type: 'down' });
        this.eventApplier.enqueue({ ...base, type: 'up' });
        await this.eventApplier.flush();
        return { status: 'dispatched' };
    }
    /** @deprecated Alias — blueprints historically called resolveAndClickDomInput; now id-addressed. */
    async resolveAndClickDomInput(selector, contextId = 1) {
        return this.resolveAndClickDomInputByNodeId(selector, contextId);
    }
    async resolveAndTypeDomInput(selector, value, contextId = 1) {
        const click = await this.resolveAndClickDomInputByNodeId(selector, contextId);
        if (click.status !== 'dispatched' || !this.eventApplier)
            return click;
        await new Promise((r) => setTimeout(r, 80));
        for (const ch of value) {
            this.eventApplier.enqueue({
                schemaVersion: 1,
                type: 'keyDown',
                key: ch,
                code: ch,
            });
            this.eventApplier.enqueue({
                schemaVersion: 1,
                type: 'keyUp',
                key: ch,
                code: ch,
            });
        }
        await this.eventApplier.flush();
        return { status: 'dispatched' };
    }
    async resolveAndScrollElementDomInput(selector, scrollTop, contextId = 1) {
        if (!this.eventApplier) {
            return { status: 'dropped', reason: 'input_applier_missing' };
        }
        const keyed = await this.loopbackInvoke('keyOfSelector', { selector, contextId });
        if (!keyed.ok || typeof keyed.nodeId !== 'number' || keyed.nodeId <= 0) {
            return { status: 'dropped', reason: keyed.reason ?? 'selector_miss' };
        }
        this.eventApplier.enqueue({
            schemaVersion: 1,
            type: 'scrollSet',
            contextId,
            nodeId: keyed.nodeId,
            scrollX: 0,
            scrollY: scrollTop,
        });
        await this.eventApplier.flush();
        return { status: 'dispatched' };
    }
    async resolveAndScrollViewportDomInput(scrollY, scrollX = 0, contextId = 1) {
        if (!this.eventApplier) {
            return { status: 'dropped', reason: 'input_applier_missing' };
        }
        this.eventApplier.enqueue({
            schemaVersion: 1,
            type: 'scrollSet',
            contextId,
            nodeId: null,
            scrollX,
            scrollY,
        });
        await this.eventApplier.flush();
        return { status: 'dispatched' };
    }
    async resolveClickTarget(contextId, nodeId, x, y) {
        const r = await this.loopbackInvoke('resolveNodeHit', { contextId, nodeId, x, y });
        if (!r.ok || typeof r.x !== 'number' || typeof r.y !== 'number') {
            return { ok: false, reason: r.reason ?? 'node_not_found' };
        }
        return { ok: true, x: r.x, y: r.y };
    }
    async applyScrollSet(args) {
        const r = await this.loopbackInvoke('applyScrollSet', args);
        if (!r.ok)
            return { ok: false, error: r.reason ?? 'apply_scroll_failed' };
        return { ok: true };
    }
    /**
     * Lab/diag — timed direct loopback `applyScrollSet` (bypasses EventApplier queue).
     * Pair with `SPECULUM_DIAG_LOOPBACK=1` + `drainInvokeDiagTraces()` for heartbeat evidence.
     */
    async measureApplyScrollSet(args) {
        const t0 = performance.now();
        const r = await this.applyScrollSet(args);
        return { ...r, wallMs: performance.now() - t0 };
    }
    /** Lab/unit oracle — Node↔Virtual loopback establish symmetry (loopback.md §14). */
    async probeLoopbackStatus() {
        const ev = await this.evaluate(`(() => {
      const ft = globalThis.__speculumProjection?.frameTransport;
      return !!(ft && ft.isEstablished);
    })()`);
        return {
            nodeEstablished: this.dataPlane.isEstablished,
            virtualEstablished: ev.ok === true && ev.value === 'true',
            generation: this.generation,
        };
    }
    async pushCameraFrame(_frame) { }
    async pushMicrophoneAudio(_chunk) { }
    async haltClocks() {
        return this.loopbackInvoke('haltWorld', {});
    }
    async resumeClocks() {
        return this.loopbackInvoke('resumeWorld', {});
    }
    async emitFrame(_contextId) {
        return this.loopbackInvoke('flushFrame', {});
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
            const r = await this.dataPlane.invoke('snapshotContext', {
                contextId,
                includeTree,
                cssom,
            });
            if (!r.ok) {
                return { ok: false, reason: r.error?.message ?? 'snapshot_invoke_failed' };
            }
            const payload = r.value;
            if (!payload || typeof payload !== 'object') {
                return { ok: false, reason: 'snapshot_empty' };
            }
            if (payload.ok === false) {
                return { ok: false, reason: payload.reason ?? 'snapshot_failed' };
            }
            if (payload.ok === true && 'value' in payload) {
                return {
                    ok: true,
                    value: payload.value,
                };
            }
            return { ok: false, reason: 'snapshot_shape' };
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
    async getAsset(key, opts) {
        return this.assets.getAsset(key, opts);
    }
    /** gRPC / BrowserSession alias — same L1 as {@link getAsset}. */
    async getDomAsset(key, opts) {
        return this.getAsset(key, opts);
    }
    async putUpload(_id, _body, _contentType, _name) { }
    async putDomUpload(id, body, contentType, name) {
        return this.putUpload(id, body, contentType, name);
    }
    sendControl(message) {
        this.dataPlane.sendControl(message);
    }
    /** Live lookup for `sparse-cdp` — `this.cdpSession` is reassigned on every `freshPage()`. */
    currentCdpSession() {
        if (!this.cdpSession) {
            throw Object.assign(new Error('no active CDP session for sparse-cdp input adapter'), {
                code: 'FAILED_PRECONDITION',
                errorCode: 'cdp_session_unavailable',
                phase: 'input',
            });
        }
        return this.cdpSession;
    }
    async freshPage(dataPlaneUrl, options) {
        const context = this.context;
        if (!context)
            throw new Error('context not open');
        // Create the replacement tab BEFORE closing the old one. After CDP
        // Extensions.loadUnpacked, Chrome 152 can fail Target.createTarget when no
        // page target remains (session navigate used to close-then-open).
        const p = await context.newPage();
        const stale = context.pages().filter((x) => x !== p);
        for (const old of stale) {
            try {
                await old.close();
            }
            catch {
                /* best-effort */
            }
        }
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
        this.cdpSession = await context.newCDPSession(p);
        const resolvedLaunch = await (0, inject_1.resolveLaunchScripts)(options.scripts ?? []);
        const installer = new inject_1.ProjectionRuntimeInstaller({
            context,
            page: p,
            rootCdp: this.cdpSession,
            config: {
                sessionId: this.sessionId,
                transport: 'loopback',
                dataPlaneUrl,
                loopbackCarrier: (process.env.SPECULUM_LOOPBACK_CARRIER === 'page-ws'
                    ? 'page-ws'
                    : 'extension'),
                planeBridgeToken: this.planeBridgeToken,
                frameRateHz: options.frameRateHz ?? 60,
                telemetry,
                generation: this.generation,
                cssomPollHz: telemetry.cssomPoll === false ? 0 : 5,
            },
            launchScripts: resolvedLaunch,
            includeCspDiag: (0, cspDiag_1.isCspDiagEnabled)(),
        });
        await installer.install();
        await (0, documentResponseHook_1.installDocumentResponseHook)(this.cdpSession, {
            mutators: [documentResponseHook_1.cspDocumentMutator],
            context,
            page: p,
        });
        // Locale / OAuth popups → same tab so CSP surgery + data plane stay on the primary page.
        (0, singleTab_1.installSingleTabAdoption)({
            page: p,
            context,
            adoptUrlOnPrimary: async (url) => {
                const allowed = options.allowedNavigationDomains;
                if (allowed && allowed.length > 0) {
                    try {
                        const host = new URL(url).hostname;
                        if (!(0, Navigation_1.matchesAllowedDomain)(host, allowed)) {
                            this.events.onMainFrameNavigationBlocked(url);
                            return;
                        }
                    }
                    catch {
                        return;
                    }
                }
                await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
                await this.dataPlane.waitEstablished({ generation: this.generation });
                this.url = p.url() || url;
                this.events.onLocationChanged(this.url);
                this.editableFocus.rebind(p);
            },
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
    /** Sidecar → Virtual domain RPC via loopback mux (not CDP). */
    async loopbackInvoke(name, args) {
        const r = await this.dataPlane.invoke(name, args);
        if (!r.ok) {
            return { ok: false, reason: r.error?.message ?? 'invoke_failed' };
        }
        const value = r.value;
        if (value && typeof value === 'object' && 'ok' in value && value.ok === false) {
            return value;
        }
        if (value && typeof value === 'object') {
            return { ok: true, ...value };
        }
        return { ok: true };
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