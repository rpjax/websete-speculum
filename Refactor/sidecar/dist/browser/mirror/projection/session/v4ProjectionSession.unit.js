"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runV4ProjectionSessionUnitTests = runV4ProjectionSessionUnitTests;
const assert_1 = __importDefault(require("assert"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_http_1 = __importDefault(require("node:http"));
const node_path_1 = __importDefault(require("node:path"));
const assetRoots_1 = require("../lab/assetRoots");
const V4ProjectionBrowserSession_1 = require("./V4ProjectionBrowserSession");
const v4LabLaunch_1 = require("./v4LabLaunch");
const telemetry_1 = require("../models/telemetry");
function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
async function runV4ProjectionSessionUnitTests() {
    if (process.env.SPECULUM_SKIP_V4_SESSION === '1') {
        console.log('[unit] V4ProjectionBrowserSession skipped (SPECULUM_SKIP_V4_SESSION=1)');
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
    const events = {
        onVideoFrame: () => undefined,
        onAudioFrame: () => undefined,
        onPageProjectionDiff: () => {
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
    const factory = (0, V4ProjectionBrowserSession_1.createV4ProjectionBrowserSessionFactory)({ headless: true });
    const session = factory.create('unit-v4', events);
    try {
        await session.launch((0, v4LabLaunch_1.v4LabLaunchOptions)({
            frameRateHz: 30,
            projectionTelemetry: { ...telemetry_1.LAB_TELEMETRY_DEFAULTS },
            cpuProfiling: false,
        }));
        await session.navigate(url);
        const deadline = Date.now() + 30_000;
        while (frames < 1 && Date.now() < deadline)
            await wait(50);
        assert_1.default.ok(frames >= 1, `expected at least one projection frame, got ${frames}`);
        const o2 = await session.flushProjectionSnapshot?.({ includeTree: false });
        assert_1.default.ok(o2?.ok && o2.o2, `coherent snapshot failed: ${o2?.reason}`);
        assert_1.default.strictEqual(o2.o2.kind, 'table_live');
        assert_1.default.strictEqual(o2.o2.identical, true, JSON.stringify(o2.o2.divergences.slice(0, 3)));
        assert_1.default.ok(o2.table && o2.table.rowCount >= 0);
        assert_1.default.ok(typeof o2.table?.tableHash === 'string');
        assert_1.default.ok((o2.sequence ?? 0) >= 1);
        const resumed = await session.resumeProjectionWorld?.();
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
    console.log('[unit] V4ProjectionBrowserSession frames+O2+halt/flush ok');
}
//# sourceMappingURL=v4ProjectionSession.unit.js.map