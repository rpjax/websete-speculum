"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPageProjectionInputClickUnitTests = runPageProjectionInputClickUnitTests;
const assert_1 = __importDefault(require("assert"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_http_1 = __importDefault(require("node:http"));
const node_path_1 = __importDefault(require("node:path"));
const assetRoots_1 = require("../lab/assetRoots");
const PageProjectionBrowserSession_1 = require("../session/PageProjectionBrowserSession");
const labLaunch_1 = require("../session/labLaunch");
const telemetry_1 = require("@speculum/page-projection/core/telemetry");
function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
async function runPageProjectionInputClickUnitTests() {
    if (process.env.SPECULUM_SKIP_PP_SESSION === '1') {
        console.log('[unit] PP input click skipped (SPECULUM_SKIP_PP_SESSION=1)');
        return;
    }
    const { fixturesDir } = (0, assetRoots_1.labAssetRoots)();
    const fixture = node_path_1.default.join(fixturesDir, 'input-click.html');
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
    const events = {
        onVideoFrame: () => undefined,
        onAudioFrame: () => undefined,
        onPageProjectionFrame: () => {
            frames += 1;
        },
        onPageProjectionTelemetry: () => undefined,
        onConsole: () => undefined,
        onLocationChanged: () => undefined,
        onMainFrameNavigationBlocked: () => undefined,
        onEditableFocusChanged: () => undefined,
        onCameraPermissionRequested: async () => 'deny',
        onMicrophonePermissionRequested: async () => 'deny',
        onCrash: () => undefined,
    };
    const factory = (0, PageProjectionBrowserSession_1.createPageProjectionBrowserSessionFactory)({ headless: true });
    const session = factory.create('unit-pp-input', events);
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
        assert_1.default.ok(frames >= 1, 'expected projection frames before input');
        await wait(500);
        const resolved = await session.evaluate(`(() => {
        const p = globalThis.__speculumProjection;
        if (!p) return { ok: false, reason: 'producer' };
        const el = document.getElementById('click-me');
        if (!el) return { ok: false, reason: 'missing_button' };
        const id = p.domNodes.keyOf(el);
        const rect = el.getBoundingClientRect();
        return {
          ok: true,
          id,
          generation: p.domNodes.generation,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      })()`);
        assert_1.default.ok(resolved.ok, resolved.errorMessage);
        const info = JSON.parse(resolved.value ?? '{}');
        assert_1.default.ok(info.id > 0, 'button node id');
        const payloadJson = JSON.stringify({
            x: info.x,
            y: info.y,
            button: 0,
            buttons: 0,
            modifiers: {},
        });
        const base = {
            generation: info.generation,
            targetId: info.id,
            contextId: 1,
            payloadJson,
        };
        const pushDom = session;
        const stale = await pushDom.pushInput({
            ...base,
            type: 'mousedown',
            generation: info.generation + 99,
        });
        assert_1.default.strictEqual(stale.status, 'dropped');
        assert_1.default.strictEqual(stale.reason, 'generation_stale');
        for (const type of ['mousemove', 'mousedown', 'mouseup']) {
            const out = await pushDom.pushInput({ ...base, type });
            assert_1.default.strictEqual(out.status, 'dispatched', type);
        }
        await wait(300);
        const status = await session.evaluate(`document.getElementById('status')?.getAttribute('data-state') ?? ''`);
        assert_1.default.ok(status.ok, status.errorMessage);
        assert_1.default.strictEqual(status.value, 'clicked', 'Virtual must reflect click');
    }
    finally {
        await session.dispose();
        await new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    }
    console.log('[unit] PP input click + stale generation ok');
}
//# sourceMappingURL=pageProjectionInputClick.unit.js.map