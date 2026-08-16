"use strict";
/**
 * Lab: CSSOM heavy magazine fixture. Observe then fold.
 * Programmatic bar: Virtual DOM O2 + CSSOM table×live after settle and after acts.
 * Human bar: 4077 Projected must look like Virtual (theme, masthead, hot card).
 * cssomPoll is evidence, not isomorphism.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_http_1 = __importDefault(require("node:http"));
const node_path_1 = __importDefault(require("node:path"));
const assetRoots_1 = require("./assetRoots");
const nodeTableApply_1 = require("./nodeTableApply");
const runReport_1 = require("./runReport");
const telemetry_1 = require("../models/telemetry");
const opcodes_1 = require("../models/opcodes");
const decode_1 = require("../models/decode");
const V4ProjectionBrowserSession_1 = require("../session/V4ProjectionBrowserSession");
const v4LabLaunch_1 = require("../session/v4LabLaunch");
function emptyOpCounts() {
    return { sheetNew: 0, sheetDrop: 0, sheetOrder: 0, ruleNew: 0, ruleDrop: 0, ruleSet: 0 };
}
class CssomOpWindow {
    enabled = false;
    counts = emptyOpCounts();
    persistent = new decode_1.PersistentStringTable();
    assembler = new decode_1.FramePartAssembler();
    start() {
        const c = this.counts;
        c.sheetNew = 0;
        c.sheetDrop = 0;
        c.sheetOrder = 0;
        c.ruleNew = 0;
        c.ruleDrop = 0;
        c.ruleSet = 0;
        this.enabled = true;
    }
    stop() {
        this.enabled = false;
    }
    observe(buf) {
        if (!this.enabled)
            return;
        const decoded = (0, decode_1.decodeFramePart)(buf, this.persistent);
        if (!decoded.ok)
            return;
        const assembled = this.assembler.ingest(decoded.part);
        if (assembled === 'missing_part' || assembled === null)
            return;
        for (const op of assembled.ops) {
            if (op.op === opcodes_1.OpCode.SheetNew)
                this.counts.sheetNew += 1;
            else if (op.op === opcodes_1.OpCode.SheetDrop)
                this.counts.sheetDrop += 1;
            else if (op.op === opcodes_1.OpCode.SheetOrder)
                this.counts.sheetOrder += 1;
            else if (op.op === opcodes_1.OpCode.RuleNew)
                this.counts.ruleNew += 1;
            else if (op.op === opcodes_1.OpCode.RuleDrop)
                this.counts.ruleDrop += 1;
            else if (op.op === opcodes_1.OpCode.RuleSet)
                this.counts.ruleSet += 1;
        }
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function stubEvents(onFrame, onTel) {
    return {
        onVideoFrame: () => undefined,
        onAudioFrame: () => undefined,
        onPageProjectionDiff: (diff) => onFrame(diff.body),
        onPageProjectionTelemetry: (m) => onTel(m),
        onConsole: () => undefined,
        onLocationChanged: () => undefined,
        onMainFrameNavigationBlocked: () => undefined,
        onEditableFocusChanged: () => undefined,
        onCameraPermissionRequested: async () => 'deny',
        onMicrophonePermissionRequested: async () => 'deny',
        onCrash: () => undefined,
    };
}
async function startFixtureHttp() {
    const { fixturesDir } = (0, assetRoots_1.labAssetRoots)();
    const server = node_http_1.default.createServer((req, res) => {
        const url = req.url ?? '/';
        if (url.startsWith('/fixtures/')) {
            const pathname = url.split('?')[0] ?? url;
            const file = node_path_1.default.join(fixturesDir, decodeURIComponent(pathname.slice('/fixtures/'.length)));
            if (!file.startsWith(node_path_1.default.normalize(fixturesDir)) || !node_fs_1.default.existsSync(file)) {
                res.writeHead(404).end('not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            node_fs_1.default.createReadStream(file).pipe(res);
            return;
        }
        res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string')
        throw new Error('fixture http: no port');
    return {
        origin: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        }),
    };
}
function formatOracle(label, o) {
    if (!o)
        return `${label}=missing`;
    if (o.identical)
        return `${label}=identical`;
    return `${label} divergences=${o.divergenceCount} ${JSON.stringify(o.divergences).slice(0, 400)}`;
}
async function snap(session, cssom) {
    const flush = session.flushProjectionSnapshot;
    if (!flush)
        return { ok: false, reason: 'flushProjectionSnapshot missing' };
    try {
        return await flush.call(session, { includeTree: false, cssom });
    }
    finally {
        await session.resumeProjectionWorld?.();
    }
}
function fail(id, reason) {
    return { id, status: 'fail', reason };
}
function pass(id, reason) {
    return { id, status: 'pass', reason };
}
function verdictFromSnap(obs) {
    const s = obs.result;
    if (!s.ok)
        return fail(obs.id, s.reason ?? `${obs.mode} snapshot failed`);
    if (!s.o2?.identical)
        return fail(obs.id, formatOracle('o2', s.o2));
    if (!s.cssomO2?.identical)
        return fail(obs.id, formatOracle('cssomO2', s.cssomO2));
    return pass(obs.id, formatOracle('cssomO2', s.cssomO2));
}
async function recordAct(session, journal, name) {
    const r = await session.evaluate(`window.__cssomLab.act(${JSON.stringify(name)})`);
    journal.acts.push({
        name,
        ok: r.ok,
        error: r.ok ? undefined : (r.errorMessage ?? 'evaluate failed'),
    });
}
function foldVerdicts(journal, extras) {
    const verdicts = [];
    for (const a of journal.acts) {
        if (!a.ok)
            verdicts.push(fail(`act.${a.name}`, a.error ?? 'evaluate failed'));
    }
    for (const s of journal.snaps)
        verdicts.push(verdictFromSnap(s));
    if (journal.themeOps) {
        if (journal.themeOps.sheetDrop > 0) {
            verdicts.push(fail('theme.ops', `SHEET_DROP=${journal.themeOps.sheetDrop} on in-place theme`));
        }
        else {
            verdicts.push(pass('theme.ops', `sheetDrop=0 ruleSet=${journal.themeOps.ruleSet} ruleNew=${journal.themeOps.ruleNew}`));
        }
    }
    if (extras.desyncs > 0)
        verdicts.push(fail('desync', `desynced events=${extras.desyncs}`));
    else
        verdicts.push(pass('desync', 'none'));
    if (extras.nodeApplyError)
        verdicts.push(fail('nodeTable', extras.nodeApplyError));
    else
        verdicts.push(pass('nodeTable', 'phase-1 apply ok'));
    return verdicts;
}
async function main() {
    const headed = process.env.SPECULUM_LAB_HEADED === '1';
    const httpServer = await startFixtureHttp();
    const target = `${httpServer.origin}/fixtures/cssom-heavy.html?auto=0`;
    const opWindow = new CssomOpWindow();
    const nodeTable = new nodeTableApply_1.NodeTableApplier();
    const tel = [];
    let idlePolls = 0;
    let desyncs = 0;
    const onTel = (m) => {
        tel.push(m);
        if (m.kind === 'cssomPoll' && m.source === 'idle')
            idlePolls += 1;
        if (m.kind === 'desynced')
            desyncs += 1;
    };
    const onFrame = (buf) => {
        opWindow.observe(buf);
        nodeTable.observeFrameBytes(buf);
    };
    const factory = (0, V4ProjectionBrowserSession_1.createV4ProjectionBrowserSessionFactory)({ headless: !headed });
    const session = factory.create('cssom-heavy', stubEvents(onFrame, onTel));
    const journal = { snaps: [], acts: [], themeOps: null };
    let runError = null;
    try {
        await session.launch((0, v4LabLaunch_1.v4LabLaunchOptions)({
            frameRateHz: 60,
            projectionTelemetry: { ...telemetry_1.LAB_TELEMETRY_DEFAULTS },
            cpuProfiling: false,
        }));
        await session.navigate(target);
        await sleep(2000);
        journal.snaps.push({ id: 'settle.scan', mode: 'scan', result: await snap(session, 'scan') });
        opWindow.start();
        await recordAct(session, journal, 'theme');
        await sleep(1200);
        opWindow.stop();
        journal.themeOps = { ...opWindow.counts };
        journal.snaps.push({ id: 'theme.scan', mode: 'scan', result: await snap(session, 'scan') });
        for (const name of ['accent', 'featureCard', 'reorderAdopted']) {
            await recordAct(session, journal, name);
            await sleep(1200);
            journal.snaps.push({ id: `${name}.scan`, mode: 'scan', result: await snap(session, 'scan') });
        }
        session.sendPageProjectionControl?.({ type: 'requestResync', reason: 'cssom-heavy' });
        await sleep(1500);
        journal.snaps.push({ id: 'resync.scan', mode: 'scan', result: await snap(session, 'scan') });
    }
    catch (err) {
        runError = err instanceof Error ? err.message : String(err);
    }
    finally {
        await session.dispose();
        await httpServer.close();
    }
    const verdicts = foldVerdicts(journal, {
        desyncs,
        nodeApplyError: nodeTable.lastApplyError,
        idlePolls,
    });
    if (runError)
        verdicts.unshift(fail('run', runError));
    const failed = verdicts.filter((v) => v.status === 'fail');
    const report = {
        meta: {
            timestamp: new Date().toISOString(),
            url: target,
            kind: 'cssom-heavy',
            lookFor: [
                'Masthead bar rust ↔ steel blue',
                'Page cream ↔ ink',
                'One card with hot outline',
                'Projected overlay gone once cards show',
            ],
        },
        verdicts,
        evidence: {
            idlePolls,
            desyncs,
            cssomPollEvents: tel.filter((m) => m.kind === 'cssomPoll').length,
            themeOps: journal.themeOps,
            acts: journal.acts,
            nodeTable: nodeTable.snapshot().table,
            applyError: nodeTable.lastApplyError,
        },
    };
    const dir = node_path_1.default.join((0, runReport_1.defaultLabRunsDir)(), `${report.meta.timestamp.replace(/[:.]/g, '-')}-cssom-heavy`);
    await node_fs_1.default.promises.mkdir(dir, { recursive: true });
    const reportPath = node_path_1.default.join(dir, 'report.json');
    await node_fs_1.default.promises.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(reportPath);
    for (const v of verdicts) {
        console.log(`${v.status === 'pass' ? 'PASS' : 'FAIL'} ${v.id}: ${v.reason}`);
    }
    if (failed.length > 0)
        process.exitCode = 1;
}
void main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=cssomHeavyRun.js.map