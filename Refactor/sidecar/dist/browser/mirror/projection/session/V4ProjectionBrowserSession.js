"use strict";
/**
 * PageProjection V4 BrowserSession — Patchright Chromium + in-page producer + owned data plane.
 * Production PatchrightBrowserSession / LivePageProjection stay untouched until M1 cutover.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.V4ProjectionBrowserSession = void 0;
exports.createV4ProjectionBrowserSessionFactory = createV4ProjectionBrowserSessionFactory;
const patchright_1 = require("patchright");
const buildConfigPreScript_1 = require("../inject/buildConfigPreScript");
const loadInpageScript_1 = require("../inject/loadInpageScript");
const virtualSnapshot_1 = require("../lab/virtualSnapshot");
const cpuProfile_1 = require("../lab/cpuProfile");
const telemetry_1 = require("../models/telemetry");
const plane_1 = require("../plane");
const projectionDataPlaneHost_1 = require("./projectionDataPlaneHost");
function chromeArgs() {
    return [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--no-first-run',
        '--no-default-browser-check',
    ];
}
function peekFrameHeader(buf) {
    if (buf.length < 12)
        return null;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (view.getUint16(0, true) !== 0x5050)
        return null;
    return { generation: view.getUint32(4, true), sequence: view.getUint32(8, true) };
}
class V4ProjectionBrowserSession {
    sessionId;
    events;
    open = false;
    width = 1280;
    height = 720;
    url = 'about:blank';
    launchOpts = null;
    browser = null;
    context = null;
    page = null;
    cdpSession = null;
    generation = 1;
    cpuAllowed = false;
    cpuRunning = false;
    dataPlane = new projectionDataPlaneHost_1.ProjectionDataPlaneHost();
    headless;
    constructor(sessionId, events, factoryOpts) {
        this.sessionId = sessionId;
        this.events = events;
        this.headless = factoryOpts.headless;
        this.dataPlane.dataPlane.setHandler((channel, payload) => {
            if (channel === plane_1.PlaneChannel.Frame) {
                const header = peekFrameHeader(payload);
                this.events.onPageProjectionDiff?.({
                    sequence: header?.sequence ?? 0,
                    generation: header?.generation ?? 0,
                    plane: '',
                    operation: '',
                    timestampMs: Date.now(),
                    body: payload,
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
        });
    }
    async launch(options) {
        this.launchOpts = options;
        this.width = options.width;
        this.height = options.height;
        this.cpuAllowed = options.cpuProfiling === true;
        if (options.mirrorMode !== 'pageProjection') {
            throw new Error('V4ProjectionBrowserSession requires mirrorMode pageProjection');
        }
        (0, loadInpageScript_1.loadInpageScript)();
        await this.dataPlane.listen();
        const browser = await patchright_1.chromium.launch({ headless: this.headless, args: chromeArgs() });
        this.browser = browser;
        this.context = await browser.newContext({
            viewport: { width: this.width, height: this.height },
        });
        this.generation = 1;
        this.open = true;
        this.events.onLocationChanged(this.url);
        return { width: this.width, height: this.height };
    }
    async stop() {
        this.open = false;
        this.cdpSession = null;
        const browser = this.browser;
        this.browser = null;
        this.context = null;
        this.page = null;
        if (browser)
            await browser.close();
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
            resizing: false,
            width: this.width,
            height: this.height,
            displayWidth: 0,
            displayHeight: 0,
            chromeWidth: this.open ? this.width : 0,
            chromeHeight: this.open ? this.height : 0,
        };
    }
    async restoreState(_state) {
        return { total: 0, skipped: 0, normalized: 0, applied: 0, failedIndividual: 0 };
    }
    async exportState() {
        return { cookies: [], localStorage: [], idbRecords: [], history: [] };
    }
    async navigate(url) {
        const opts = this.requireLaunch();
        const dataPlaneUrl = this.dataPlane.listenUrl;
        if (this.page) {
            this.generation += 1;
            await this.page.close();
            this.cdpSession = null;
        }
        this.page = await this.freshPage(dataPlaneUrl, opts);
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        this.url = url;
        this.events.onLocationChanged(url);
    }
    async refresh() {
        if (this.url && this.url !== 'about:blank')
            await this.navigate(this.url);
    }
    async resize(request) {
        this.width = request.width;
        this.height = request.height;
        await this.page?.setViewportSize({ width: this.width, height: this.height });
        return { ok: true, width: this.width, height: this.height, chromeWidth: this.width, chromeHeight: this.height };
    }
    async probe(_request) {
        return { ok: false, errorCode: 'unsupported', message: 'use PageProjection probes on this session' };
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
    async pushInput(_input) {
        // V4 lab session does not emulate OS input; lab UI applies on the client surface.
    }
    async pushCameraFrame(_frame) { }
    async pushMicrophoneAudio(_chunk) { }
    async haltProjectionWorld() {
        return this.callProducer(`(() => {
        const p = globalThis.__speculumProjection;
        if (!p || typeof p.haltWorld !== 'function') return { ok: false, reason: 'producer missing' };
        p.haltWorld();
        return { ok: true };
      })()`);
    }
    async resumeProjectionWorld() {
        return this.callProducer(`(() => {
        const p = globalThis.__speculumProjection;
        if (!p || typeof p.resumeWorld !== 'function') return { ok: false, reason: 'producer missing' };
        p.resumeWorld();
        return { ok: true };
      })()`);
    }
    async flushProjectionFrame() {
        return this.callProducer(`(() => {
        const p = globalThis.__speculumProjection;
        if (!p || typeof p.flushFrame !== 'function') return { ok: false, reason: 'producer missing' };
        const r = p.flushFrame();
        return { ok: true, generation: r.generation, sequence: r.sequence };
      })()`);
    }
    async snapshotProjectionVirtual(opts) {
        const page = this.requirePage();
        const meta = await this.callProducer(`(() => {
        const p = globalThis.__speculumProjection;
        if (!p) return { ok: false, reason: 'producer missing' };
        return {
          ok: true,
          generation: p.domNodes.generation,
          sequence: p.frameEmitter.currentSequence,
          tableSize: p.table.size,
        };
      })()`);
        if (!meta.ok)
            return meta;
        if (opts?.includeTree === false)
            return meta;
        try {
            const tree = await (0, virtualSnapshot_1.captureVirtualSnapshot)(page);
            return { ...meta, tree };
        }
        catch (err) {
            return { ...meta, reason: err instanceof Error ? err.message : String(err) };
        }
    }
    async compareProjectionTableToLiveDom() {
        const raw = await this.callProducer(`(() => {
        const p = globalThis.__speculumProjection;
        if (!p || typeof p.compareTableToLiveDom !== 'function') {
          return { ok: false, reason: 'compareTableToLiveDom missing' };
        }
        return { ok: true, result: p.compareTableToLiveDom() };
      })()`);
        return raw;
    }
    async flushProjectionSnapshot(opts) {
        try {
            return (await this.requirePage().evaluate((0, virtualSnapshot_1.coherentSnapshotExpression)(opts?.includeTree !== false)));
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
        const cdp = await this.ensureCdp();
        await (0, cpuProfile_1.startCpuProfile)(cdp);
        this.cpuRunning = true;
        return { ok: true };
    }
    async stopCpuProfile() {
        if (!this.cpuRunning)
            return { ok: false, reason: 'cpu profile not running' };
        const cdp = await this.ensureCdp();
        const { raw, summary } = await (0, cpuProfile_1.stopCpuProfile)(cdp, 20);
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
    sendPageProjectionControl(message) {
        this.dataPlane.sendControl(message);
    }
    async freshPage(dataPlaneUrl, options) {
        const context = this.context;
        if (!context)
            throw new Error('context not open');
        const p = await context.newPage();
        p.on('console', (msg) => this.events.onConsole(consoleLevel(msg.type()), msg.text()));
        p.on('pageerror', (err) => this.events.onConsole(3, err.message));
        const telemetry = (options.projectionTelemetry ?? telemetry_1.LAB_TELEMETRY_DEFAULTS);
        const configPre = (0, buildConfigPreScript_1.buildConfigPreScript)({
            transport: 'loopback',
            dataPlaneUrl,
            frameRateHz: options.frameRateHz ?? 60,
            telemetry,
            generation: this.generation,
        });
        await p.addInitScript({ content: configPre });
        await p.addInitScript({ content: (0, loadInpageScript_1.loadInpageScript)() });
        return p;
    }
    requirePage() {
        if (!this.page)
            throw new Error('V4ProjectionBrowserSession: page not open');
        return this.page;
    }
    requireLaunch() {
        if (!this.launchOpts)
            throw new Error('V4ProjectionBrowserSession: not launched');
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
exports.V4ProjectionBrowserSession = V4ProjectionBrowserSession;
function consoleLevel(type) {
    if (type === 'error')
        return 3;
    if (type === 'warning')
        return 2;
    return 1;
}
function createV4ProjectionBrowserSessionFactory(opts) {
    return {
        create(sessionId, events) {
            return new V4ProjectionBrowserSession(sessionId, events, opts);
        },
    };
}
//# sourceMappingURL=V4ProjectionBrowserSession.js.map