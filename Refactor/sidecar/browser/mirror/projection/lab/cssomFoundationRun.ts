/**
 * Lab gate: CSSOM foundation. Not C6, not Projected CSS.
 * Run = observe (acts, snapshots, wire, cssomPoll). Fold verdicts at the end from
 * collected probes/bytes. cssomPoll is I10 evidence; idle===0 is a closing conclusion, not a mid-run gate.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { labAssetRoots } from './assetRoots';
import { NodeTableApplier } from './nodeTableApply';
import { defaultLabRunsDir } from './runReport';
import { LAB_TELEMETRY_DEFAULTS, type ProjectionTelemetryMessage } from '../models/telemetry';
import { OpCode } from '../models/opcodes';
import { decodeFramePart, FramePartAssembler, PersistentStringTable } from '../models/decode';
import { createV4ProjectionBrowserSessionFactory } from '../session/V4ProjectionBrowserSession';
import { v4LabLaunchOptions } from '../session/v4LabLaunch';
import type { BrowserSession, BrowserSessionEvents } from '../../../BrowserSession';
import type { TableLiveOracleResult } from '../models/tableLiveOracle';
import type { CssomTableLiveOracleResult } from '../models/cssomTableLiveOracle';

type Verdict = { id: string; status: 'pass' | 'fail'; reason: string };

type CssomOpCounts = {
  sheetNew: number;
  sheetDrop: number;
  sheetOrder: number;
  ruleNew: number;
  ruleDrop: number;
  ruleSet: number;
};

function emptyOpCounts(): CssomOpCounts {
  return { sheetNew: 0, sheetDrop: 0, sheetOrder: 0, ruleNew: 0, ruleDrop: 0, ruleSet: 0 };
}

class CssomOpWindow {
  enabled = false;
  readonly counts: CssomOpCounts = emptyOpCounts();
  private readonly persistent = new PersistentStringTable();
  private readonly assembler = new FramePartAssembler();

  reset(): void {
    this.enabled = false;
    const c = this.counts;
    c.sheetNew = 0;
    c.sheetDrop = 0;
    c.sheetOrder = 0;
    c.ruleNew = 0;
    c.ruleDrop = 0;
    c.ruleSet = 0;
  }

  start(): void {
    this.reset();
    this.enabled = true;
  }

  stop(): void {
    this.enabled = false;
  }

  observe(buf: Uint8Array): void {
    if (!this.enabled) return;
    const decoded = decodeFramePart(buf, this.persistent);
    if (!decoded.ok) return;
    const assembled = this.assembler.ingest(decoded.part);
    if (assembled === 'missing_part' || assembled === null) return;
    for (const op of assembled.ops) {
      switch (op.op) {
        case OpCode.SheetNew:
          this.counts.sheetNew += 1;
          break;
        case OpCode.SheetDrop:
          this.counts.sheetDrop += 1;
          break;
        case OpCode.SheetOrder:
          this.counts.sheetOrder += 1;
          break;
        case OpCode.RuleNew:
          this.counts.ruleNew += 1;
          break;
        case OpCode.RuleDrop:
          this.counts.ruleDrop += 1;
          break;
        case OpCode.RuleSet:
          this.counts.ruleSet += 1;
          break;
        default:
          break;
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stubEvents(
  onFrame: (body: Uint8Array) => void,
  onTel: (m: ProjectionTelemetryMessage) => void,
): BrowserSessionEvents {
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

async function startFixtureHttp(): Promise<{ origin: string; close: () => Promise<void> }> {
  const { fixturesDir } = labAssetRoots();
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/fixtures/')) {
      const pathname = url.split('?')[0] ?? url;
      const file = path.join(fixturesDir, decodeURIComponent(pathname.slice('/fixtures/'.length)));
      if (!file.startsWith(path.normalize(fixturesDir)) || !fs.existsSync(file)) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('fixture http: no port');
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function formatOracle(label: string, o: TableLiveOracleResult | CssomTableLiveOracleResult | null | undefined): string {
  if (!o) return `${label}=missing`;
  if (o.identical) return `${label}=identical`;
  return `${label} divergences=${o.divergenceCount} ${JSON.stringify(o.divergences).slice(0, 400)}`;
}

async function snap(
  session: BrowserSession,
  cssom: 'none' | 'committed' | 'scan',
): Promise<{
  ok: boolean;
  reason?: string;
  o2?: TableLiveOracleResult;
  cssomO2?: CssomTableLiveOracleResult | null;
}> {
  const flush = session.flushProjectionSnapshot;
  if (!flush) return { ok: false, reason: 'flushProjectionSnapshot missing' };
  try {
    return await flush.call(session, { includeTree: false, cssom });
  } finally {
    await session.resumeProjectionWorld?.();
  }
}

type SnapObs = {
  id: string;
  mode: 'none' | 'committed' | 'scan';
  result: Awaited<ReturnType<typeof snap>>;
};

type ActObs = { name: string; ok: boolean; error?: string };

type Journal = {
  snaps: SnapObs[];
  acts: ActObs[];
  styleSetOps: CssomOpCounts | null;
};

function fail(id: string, reason: string): Verdict {
  return { id, status: 'fail', reason };
}

function pass(id: string, reason: string): Verdict {
  return { id, status: 'pass', reason };
}

function verdictFromSnap(obs: SnapObs): Verdict {
  const s = obs.result;
  if (!s.ok) return fail(obs.id, s.reason ?? `${obs.mode} snapshot failed`);
  if (!s.o2?.identical) return fail(obs.id, formatOracle('o2', s.o2));
  if (obs.mode === 'none') {
    if (s.cssomO2 !== null && s.cssomO2 !== undefined) {
      return fail(obs.id, `expected cssomO2=null, got ${JSON.stringify(s.cssomO2).slice(0, 200)}`);
    }
    return pass(obs.id, 'cssomO2=null; o2 identical');
  }
  if (!s.cssomO2?.identical) return fail(obs.id, formatOracle('cssomO2', s.cssomO2));
  return pass(obs.id, formatOracle('cssomO2', s.cssomO2));
}

async function recordAct(session: BrowserSession, journal: Journal, name: string): Promise<void> {
  const r = await session.evaluate(`window.__cssomLab.act(${JSON.stringify(name)})`);
  journal.acts.push({
    name,
    ok: r.ok,
    error: r.ok ? undefined : (r.errorMessage ?? 'evaluate failed'),
  });
}

async function recordSnap(
  session: BrowserSession,
  journal: Journal,
  id: string,
  mode: 'none' | 'committed' | 'scan',
): Promise<void> {
  journal.snaps.push({ id, mode, result: await snap(session, mode) });
}

async function observeAfterWait(
  session: BrowserSession,
  journal: Journal,
  id: string,
  waitMs: number,
): Promise<void> {
  if (waitMs > 0) await sleep(waitMs);
  await recordSnap(session, journal, `${id}.committed`, 'committed');
  await recordSnap(session, journal, `${id}.scan`, 'scan');
}

function foldVerdicts(journal: Journal, idlePolls: number): Verdict[] {
  const verdicts: Verdict[] = [];
  for (const a of journal.acts) {
    if (!a.ok) verdicts.push(fail(`act.${a.name}`, a.error ?? 'evaluate failed'));
  }
  for (const s of journal.snaps) verdicts.push(verdictFromSnap(s));
  if (journal.styleSetOps) {
    if (journal.styleSetOps.sheetDrop > 0) {
      verdicts.push(fail('styleSet.ops', `SHEET_DROP=${journal.styleSetOps.sheetDrop} during in-place window`));
    } else {
      verdicts.push(pass('styleSet.ops', `sheetDrop=0 ruleSet=${journal.styleSetOps.ruleSet}`));
    }
  }
  if (idlePolls < 1) {
    verdicts.push(fail('idle-sensor', `no cssomPoll idle in the whole run (cap on)`));
  }
  return verdicts;
}

async function main(): Promise<void> {
  const headed = process.env.SPECULUM_LAB_HEADED === '1';
  const httpServer = await startFixtureHttp();
  const target = `${httpServer.origin}/fixtures/cssom-foundation.html`;
  const opWindow = new CssomOpWindow();
  const nodeTable = new NodeTableApplier();
  const tel: ProjectionTelemetryMessage[] = [];
  let idlePolls = 0;
  let resyncPolls = 0;
  let sheetsAbortedSum = 0;

  const onTel = (m: ProjectionTelemetryMessage): void => {
    tel.push(m);
    if (m.kind !== 'cssomPoll') return;
    if (m.source === 'idle') idlePolls += 1;
    if (m.source === 'resync') resyncPolls += 1;
    sheetsAbortedSum += m.sheetsAborted ?? 0;
  };
  const onFrame = (buf: Uint8Array): void => {
    opWindow.observe(buf);
    nodeTable.observeFrameBytes(buf);
  };

  const factory = createV4ProjectionBrowserSessionFactory({ headless: !headed });
  const session = factory.create('cssom-foundation', stubEvents(onFrame, onTel));
  const journal: Journal = { snaps: [], acts: [], styleSetOps: null };
  let runError: string | null = null;

  try {
    await session.launch(
      v4LabLaunchOptions({
        frameRateHz: 60,
        projectionTelemetry: { ...LAB_TELEMETRY_DEFAULTS },
        cpuProfiling: false,
      }),
    );
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

    for (const name of ['insertRule', 'deleteRule'] as const) {
      await recordAct(session, journal, name);
      await observeAfterWait(session, journal, name, 1000);
    }

    await recordAct(session, journal, 'replaceSync');
    await observeAfterWait(session, journal, 'replaceSync', 2000);

    for (const name of ['reorderAdopted', 'addSheet', 'mediaInner', 'addStyleEl'] as const) {
      await recordAct(session, journal, name);
      await observeAfterWait(session, journal, name, 1000);
    }

    await recordAct(session, journal, 'addCrossOriginLink');
    await sleep(800);
    await recordSnap(session, journal, 'i7-unreadable', 'scan');

    const dom = await session.evaluate(
      `(() => { const d = document.createElement('div'); d.id = 'cssom-dom-probe'; document.body.appendChild(d); return 'ok'; })()`,
    );
    journal.acts.push({
      name: 'dom-append',
      ok: dom.ok,
      error: dom.ok ? undefined : (dom.errorMessage ?? 'append failed'),
    });
    await recordSnap(session, journal, 'dom-plus-cssom', 'scan');

    session.sendPageProjectionControl?.({ type: 'requestResync', reason: 'cssom-foundation' });
    await sleep(1500);
    await recordSnap(session, journal, 'resync', 'scan');
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
  } finally {
    await session.dispose();
    await httpServer.close();
  }

  const verdicts = foldVerdicts(journal, idlePolls);
  if (runError) verdicts.unshift(fail('run', runError));

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

  const dir = path.join(defaultLabRunsDir(), `${report.meta.timestamp.replace(/[:.]/g, '-')}-cssom-foundation`);
  await fs.promises.mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, 'report.json');
  await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(reportPath);
  for (const v of verdicts) {
    console.log(`${v.status === 'pass' ? 'PASS' : 'FAIL'} ${v.id}: ${v.reason}`);
  }
  if (failed.length > 0) process.exitCode = 1;
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
