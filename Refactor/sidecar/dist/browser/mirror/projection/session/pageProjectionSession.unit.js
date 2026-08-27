"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPageProjectionSessionUnitTests = runPageProjectionSessionUnitTests;
const assert_1 = __importDefault(require("assert"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_http_1 = __importDefault(require("node:http"));
const node_path_1 = __importDefault(require("node:path"));
const assetRoots_1 = require("../lab/assetRoots");
const PageProjectionBrowserSession_1 = require("./PageProjectionBrowserSession");
const labLaunch_1 = require("./labLaunch");
const telemetry_1 = require("@speculum/page-projection/core/telemetry");
function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function emptyEvents() {
    return {
        onVideoFrame: () => undefined,
        onAudioFrame: () => undefined,
        onPageProjectionFrame: () => undefined,
        onPageProjectionTelemetry: () => undefined,
        onConsole: () => undefined,
        onLocationChanged: () => undefined,
        onMainFrameNavigationBlocked: () => undefined,
        onEditableFocusChanged: () => undefined,
        onCameraPermissionRequested: async () => 'deny',
        onMicrophonePermissionRequested: async () => 'deny',
        onCrash: () => undefined,
    };
}
async function runPageProjectionSessionUnitTests() {
    if (process.env.SPECULUM_SKIP_PP_SESSION === '1') {
        console.log('[unit] PageProjectionBrowserSession skipped (SPECULUM_SKIP_PP_SESSION=1)');
        return;
    }
    let uinputOk = false;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        uinputOk = require('../../../input/os/uinput').uinputAvailable() === true;
    }
    catch {
        uinputOk = false;
    }
    if (!uinputOk) {
        console.log('[unit] PageProjectionBrowserSession skipped (no /dev/uinput — OS input fail-closed)');
        return;
    }
    const { fixturesDir } = (0, assetRoots_1.labAssetRoots)();
    const fixture = node_path_1.default.join(fixturesDir, 'insert-before-remove.html');
    assert_1.default.ok(node_fs_1.default.existsSync(fixture), `missing fixture ${fixture}`);
    const server = node_http_1.default.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        node_fs_1.default.createReadStream(fixture).pipe(res);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string')
        throw new Error('no port');
    const url = `http://127.0.0.1:${addr.port}/`;
    let frames = 0;
    const events = emptyEvents();
    events.onPageProjectionFrame = () => {
        frames += 1;
    };
    const factory = (0, PageProjectionBrowserSession_1.createPageProjectionBrowserSessionFactory)({ headless: true });
    const session = factory.create('unit-pp', events);
    try {
        await session.launch((0, labLaunch_1.labLaunchOptions)({
            frameRateHz: 30,
            projectionTelemetry: { ...telemetry_1.LAB_TELEMETRY_DEFAULTS },
            cpuProfiling: false,
        }));
        await session.navigate(url);
        const deadline = Date.now() + 30_000;
        while (frames < 1 && Date.now() < deadline)
            await wait(50);
        assert_1.default.ok(frames >= 1, `expected at least one projection frame, got ${frames}`);
        const snap = await session.getStateSnapshot?.(1, { table: 'full', tree: false });
        assert_1.default.ok(snap?.ok, `coherent snapshot failed: ${snap && !snap.ok ? snap.reason : 'unknown'}`);
        const rows = snap.table && typeof snap.table === 'object' && 'rows' in snap.table
            ? snap.table.rows
            : null;
        const digest = snap.table && typeof snap.table === 'object' && 'digest' in snap.table
            ? snap.table.digest
            : snap.table;
        assert_1.default.ok(rows, 'expected table rows (o2)');
        assert_1.default.strictEqual(rows.kind, 'table_live');
        assert_1.default.strictEqual(rows.identical, true, JSON.stringify((rows.divergences ?? []).slice(0, 3)));
        assert_1.default.ok(digest && digest.rowCount >= 0);
        assert_1.default.ok(typeof digest.tableHash === 'string');
        assert_1.default.ok((snap.sequence ?? 0) >= 1);
        const resumed = await session.resumeClocks?.();
        assert_1.default.ok(resumed?.ok, resumed?.reason);
        const cpuDenied = await session.startCpuProfile?.();
        assert_1.default.ok(cpuDenied && cpuDenied.ok === false, 'cpuProfiling false must refuse CDP Profiler');
    }
    finally {
        await session.dispose();
        await new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    }
    console.log('[unit] PageProjectionBrowserSession frames+O2+halt/flush ok');
    await runDocumentCspHookUnitTests();
}
/** Response-stage Document hook: meta CSP relaxed; nonce stripped; other directives preserved. */
async function runDocumentCspHookUnitTests() {
    const policy = "script-src 'nonce-test' 'strict-dynamic'; connect-src 'none'; img-src https:";
    const html = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="${policy}">
<title>csp-hook</title></head><body><p id="ok">ok</p></body></html>`;
    const server = node_http_1.default.createServer((_req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': policy,
        });
        res.end(html);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string')
        throw new Error('no port');
    const url = `http://127.0.0.1:${addr.port}/`;
    const factory = (0, PageProjectionBrowserSession_1.createPageProjectionBrowserSessionFactory)({ headless: true });
    const session = factory.create('unit-pp-csp', emptyEvents());
    try {
        await session.launch((0, labLaunch_1.labLaunchOptions)({
            frameRateHz: 10,
            projectionTelemetry: { ...telemetry_1.LAB_TELEMETRY_DEFAULTS },
            cpuProfiling: false,
        }));
        await session.navigate(url);
        const meta = await session.evaluate(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''`);
        assert_1.default.ok(meta.ok, meta.errorMessage);
        const content = meta.value;
        assert_1.default.ok(!content.includes("'nonce-test'"), `nonce stripped: ${content}`);
        assert_1.default.ok(!content.includes("'strict-dynamic'"), `strict-dynamic stripped: ${content}`);
        assert_1.default.ok(content.includes('img-src https:'), `preserved img-src: ${content}`);
        assert_1.default.ok(/connect-src[^;]*\*/.test(content), `connect-src widened: ${content}`);
        assert_1.default.ok(content.includes("'unsafe-inline'"), `inline script enabled: ${content}`);
        assert_1.default.ok(/\bscript-src[^;]*\*/.test(content), `script * compensation: ${content}`);
        assert_1.default.ok(/\bscript-src[^;]*blob:/.test(content), `script blob: compensation: ${content}`);
        assert_1.default.ok(/\bscript-src[^;]*data:/.test(content), `script data: compensation: ${content}`);
    }
    finally {
        await session.dispose();
        await new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    }
    console.log('[unit] V4 Document Response CSP hook ok');
}
//# sourceMappingURL=pageProjectionSession.unit.js.map