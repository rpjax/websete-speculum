/**
 * Lab: CSSOM heavy magazine fixture. Observe then fold.
 * Programmatic bar: Virtual DOM O2 + CSSOM table×live after settle and after acts.
 * Human bar: 4077 Projected must look like Virtual (theme, masthead, hot card).
 * cssomPoll is evidence, not isomorphism.
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

  start(): void {
    const c = this.counts;
    c.sheetNew = 0;
    c.sheetDrop = 0;
    c.sheetOrder = 0;
    c.ruleNew = 0;
    c.ruleDrop = 0;
    c.ruleSet = 0;
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
      if (op.op === OpCode.SheetNew) this.counts.sheetNew += 1;
      else if (op.op === OpCode.SheetDrop) this.counts.sheetDrop += 1;
      else if (op.op === OpCode.SheetOrder) this.counts.sheetOrder += 1;
      else if (op.op === OpCode.RuleNew) this.counts.ruleNew += 1;
      else if (op.op === OpCode.RuleDrop) this.counts.ruleDrop += 1;
      else if (op.op === OpCode.RuleSet) this.counts.ruleSet += 1;
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

type SnapObs = { id: string; mode: 'none' | 'committed' | 'scan'; result: Awaited<ReturnType<typeof snap>> };
type ActObs = { name: string; ok: boolean; error?: string };
type Journal = { snaps: SnapObs[]; acts: ActObs[]; themeOps: CssomOpCounts | null };

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

function foldVerdicts(
  journal: Journal,
  extras: { desyncs: number; nodeApplyError: string | null; idlePolls: number },
): Verdict[] {
  const verdicts: Verdict[] = [];
  for (const a of journal.acts) {
    if (!a.ok) verdicts.push(fail(`act.${a.name}`, a.error ?? 'evaluate failed'));
  }
  for (const s of journal.snaps) verdicts.push(verdictFromSnap(s));
  if (journal.themeOps) {
    if (journal.themeOps.sheetDrop > 0) {
      verdicts.push(fail('theme.ops', `SHEET_DROP=${journal.themeOps.sheetDrop} on in-place theme`));
    } else {
      verdicts.push(
        pass(
          'theme.ops',
          `sheetDrop=0 ruleSet=${journal.themeOps.ruleSet} ruleNew=${journal.themeOps.ruleNew}`,
        ),
      );
    }
  }
  if (extras.desyncs > 0) verdicts.push(fail('desync', `desynced events=${extras.desyncs}`));
  else verdicts.push(pass('desync', 'none'));
  if (extras.nodeApplyError) verdicts.push(fail('nodeTable', extras.nodeApplyError));
  else verdicts.push(pass('nodeTable', 'phase-1 apply ok'));
  return verdicts;
}

async function main(): Promise<void> {
  const headed = process.env.SPECULUM_LAB_HEADED === '1';
  const httpServer = await startFixtureHttp();
  const target = `${httpServer.origin}/fixtures/cssom-heavy.html?auto=0`;
  const opWindow = new CssomOpWindow();
  const nodeTable = new NodeTableApplier();
  const tel: ProjectionTelemetryMessage[] = [];
  let idlePolls = 0;
  let desyncs = 0;

  const onTel = (m: ProjectionTelemetryMessage): void => {
    tel.push(m);
    if (m.kind === 'cssomPoll' && m.source === 'idle') idlePolls += 1;
    if (m.kind === 'desynced') desyncs += 1;
  };
  const onFrame = (buf: Uint8Array): void => {
    opWindow.observe(buf);
    nodeTable.observeFrameBytes(buf);
  };

  const factory = createV4ProjectionBrowserSessionFactory({ headless: !headed });
  const session = factory.create('cssom-heavy', stubEvents(onFrame, onTel));
  const journal: Journal = { snaps: [], acts: [], themeOps: null };
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
    await sleep(2000);
    journal.snaps.push({ id: 'settle.scan', mode: 'scan', result: await snap(session, 'scan') });

    opWindow.start();
    await recordAct(session, journal, 'theme');
    await sleep(1200);
    opWindow.stop();
    journal.themeOps = { ...opWindow.counts };
    journal.snaps.push({ id: 'theme.scan', mode: 'scan', result: await snap(session, 'scan') });

    for (const name of ['accent', 'featureCard', 'reorderAdopted'] as const) {
      await recordAct(session, journal, name);
      await sleep(1200);
      journal.snaps.push({ id: `${name}.scan`, mode: 'scan', result: await snap(session, 'scan') });
    }

    session.sendPageProjectionControl?.({ type: 'requestResync', reason: 'cssom-heavy' });
    await sleep(1500);
    journal.snaps.push({ id: 'resync.scan', mode: 'scan', result: await snap(session, 'scan') });
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
  } finally {
    await session.dispose();
    await httpServer.close();
  }

  const verdicts = foldVerdicts(journal, {
    desyncs,
    nodeApplyError: nodeTable.lastApplyError,
    idlePolls,
  });
  if (runError) verdicts.unshift(fail('run', runError));

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

  const dir = path.join(defaultLabRunsDir(), `${report.meta.timestamp.replace(/[:.]/g, '-')}-cssom-heavy`);
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
