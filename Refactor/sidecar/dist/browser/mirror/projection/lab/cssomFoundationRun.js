"use strict";
/**
 * Lab gate: CSSOM foundation. Not C6, not Projected CSS.
 * Run = observe (acts, snapshots, wire, cssomPoll). Fold verdicts at the end from
 * collected probes/bytes. cssomPoll is I10 evidence; idle===0 is a closing conclusion, not a mid-run gate.
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
    reset() {
        this.enabled = false;
        const c = this.counts;
        c.sheetNew = 0;
        c.sheetDrop = 0;
        c.sheetOrder = 0;
        c.ruleNew = 0;
        c.ruleDrop = 0;
        c.ruleSet = 0;
    }
    start() {
        this.reset();
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
            switch (op.op) {
                case opcodes_1.OpCode.SheetNew:
                    this.counts.sheetNew += 1;
                    break;
                case opcodes_1.OpCode.SheetDrop:
                    this.counts.sheetDrop += 1;
                    break;
                case opcodes_1.OpCode.SheetOrder:
                    this.counts.sheetOrder += 1;
                    break;
                case opcodes_1.OpCode.RuleNew:
                    this.counts.ruleNew += 1;
                    break;
                case opcodes_1.OpCode.RuleDrop:
                    this.counts.ruleDrop += 1;
                    break;
                case opcodes_1.OpCode.RuleSet:
                    this.counts.ruleSet += 1;
                    break;
                default:
                    break;
            }
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
    if (obs.mode === 'none') {
        if (s.cssomO2 !== null && s.cssomO2 !== undefined) {
            return fail(obs.id, `expected cssomO2=null, got ${JSON.stringify(s.cssomO2).slice(0, 200)}`);
        }
        return pass(obs.id, 'cssomO2=null; o2 identical');
    }
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
async function recordSnap(session, journal, id, mode) {
    journal.snaps.push({ id, mode, result: await snap(session, mode) });
}
async function observeAfterWait(session, journal, id, waitMs) {
    if (waitMs > 0)
        await sleep(waitMs);
    await recordSnap(session, journal, `${id}.committed`, 'committed');
    await recordSnap(session, journal, `${id}.scan`, 'scan');
}
function foldVerdicts(journal, idlePolls) {
    const verdicts = [];
    for (const a of journal.acts) {
        if (!a.ok)
            verdicts.push(fail(`act.${a.name}`, a.error ?? 'evaluate failed'));
    }
    for (const s of journal.snaps)
        verdicts.push(verdictFromSnap(s));
    if (journal.styleSetOps) {
        if (journal.styleSetOps.sheetDrop > 0) {
            verdicts.push(fail('styleSet.ops', `SHEET_DROP=${journal.styleSetOps.sheetDrop} during in-place window`));
        }
        else {
            verdicts.push(pass('styleSet.ops', `sheetDrop=0 ruleSet=${journal.styleSetOps.ruleSet}`));
        }
    }
    if (idlePolls < 1) {
        verdicts.push(fail('idle-sensor', `no cssomPoll idle in the whole run (cap on)`));
    }
    return verdicts;
}
async function main() {
    const headed = process.env.SPECULUM_LAB_HEADED === '1';
    const httpServer = await startFixtureHttp();
    const target = `${httpServer.origin}/fixtures/cssom-foundation.html`;
    const opWindow = new CssomOpWindow();
    const nodeTable = new nodeTableApply_1.NodeTableApplier();
    const tel = [];
    let idlePolls = 0;
    let resyncPolls = 0;
    let sheetsAbortedSum = 0;
    const onTel = (m) => {
        tel.push(m);
        if (m.kind !== 'cssomPoll')
            return;
        if (m.source === 'idle')
            idlePolls += 1;
        if (m.source === 'resync')
            resyncPolls += 1;
        sheetsAbortedSum += m.sheetsAborted ?? 0;
    };
    const onFrame = (buf) => {
        opWindow.observe(buf);
        nodeTable.observeFrameBytes(buf);
    };
    const factory = (0, V4ProjectionBrowserSession_1.createV4ProjectionBrowserSessionFactory)({ headless: !headed });
    const session = factory.create('cssom-foundation', stubEvents(onFrame, onTel));
    const journal = { snaps: [], acts: [], styleSetOps: null };
    let runError = null;
    try {
        await session.launch((0, v4LabLaunch_1.v4LabLaunchOptions)({
            frameRateHz: 60,
            projectionTelemetry: { ...telemetry_1.LAB_TELEMETRY_DEFAULTS },
            cpuProfiling: false,
        }));
        await session.navigate(target);
        await sleep(1500);
        await recordSnap(session, journal, 'settle', 'scan');
        await recordSnap(session, journal, 'i8-none', 'none');
        await sleep(2000);
        opWindow.start();
        await recordAct(session, journal, 'styleSet');
        await sleep(1000);
        opWindow.stop();
        journal.styleSetOps = { ...opWindow.counts };
        await observeAfterWait(session, journal, 'styleSet', 0);
        for (const name of ['insertRule', 'deleteRule']) {
            await recordAct(session, journal, name);
            await observeAfterWait(session, journal, name, 1000);
        }
        await recordAct(session, journal, 'replaceSync');
        await observeAfterWait(session, journal, 'replaceSync', 2000);
        for (const name of ['reorderAdopted', 'addSheet', 'mediaInner', 'addStyleEl']) {
            await recordAct(session, journal, name);
            await observeAfterWait(session, journal, name, 1000);
        }
        await recordAct(session, journal, 'addCrossOriginLink');
        await sleep(800);
        await recordSnap(session, journal, 'i7-unreadable', 'scan');
        const dom = await session.evaluate(`(() => { const d = document.createElement('div'); d.id = 'cssom-dom-probe'; document.body.appendChild(d); return 'ok'; })()`);
        journal.acts.push({
            name: 'dom-append',
            ok: dom.ok,
            error: dom.ok ? undefined : (dom.errorMessage ?? 'append failed'),
        });
        await recordSnap(session, journal, 'dom-plus-cssom', 'scan');
        session.sendPageProjectionControl?.({ type: 'requestResync', reason: 'cssom-foundation' });
        await sleep(1500);
        await recordSnap(session, journal, 'resync', 'scan');
    }
    catch (err) {
        runError = err instanceof Error ? err.message : String(err);
    }
    finally {
        await session.dispose();
        await httpServer.close();
    }
    const verdicts = foldVerdicts(journal, idlePolls);
    if (runError)
        verdicts.unshift(fail('run', runError));
    const failed = verdicts.filter((v) => v.status === 'fail');
    const report = {
        meta: { timestamp: new Date().toISOString(), url: target, kind: 'cssom-foundation' },
        verdicts,
        evidence: {
            idlePolls,
            resyncPolls,
            sheetsAbortedSum,
            cssomPollEvents: tel.filter((m) => m.kind === 'cssomPoll').length,
            styleSetOps: journal.styleSetOps,
            nodeTable: nodeTable.snapshot().table,
            applyError: nodeTable.lastApplyError,
        },
    };
    const dir = node_path_1.default.join((0, runReport_1.defaultLabRunsDir)(), `${report.meta.timestamp.replace(/[:.]/g, '-')}-cssom-foundation`);
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
//# sourceMappingURL=cssomFoundationRun.js.map