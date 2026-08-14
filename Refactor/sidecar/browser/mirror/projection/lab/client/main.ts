/**
 * Lab client — Stream / Activity / Config + DOM projection apply.
 * No establish / handoff / frameDecision panels (frame-protocol.md §4.7 — those concepts
 * don't exist anymore); Stream now surfaces the table-replicated algorithm's own signals:
 * frame/op volume and per-frame build/apply cost (frame-protocol.md §5).
 */

import { LabProjectionClient } from '../../client/labProjectionClient';
import { snapshotTree } from '../../client/domTreeSnapshot';

type TelMsg = { kind?: string; [k: string]: unknown };

type ControlMessage = {
  type: string;
  sessionId?: string;
  url?: string;
  message?: string | TelMsg;
  frames?: number;
  bytes?: number;
  generation?: number | null;
  sequence?: number | null;
  dataPlaneUrl?: string;
  telemetryMessages?: number;
  durationMs?: number;
  options?: { cpuProfile: boolean; invariants: boolean; structuralDiff: boolean };
  report?: BenchmarkReport;
  reportDir?: string;
  /** `structuralDiffResult` (Stage 4 test-only, `lab/session.ts`'s `requestStructuralDiff`). */
  status?: 'ok' | 'unavailable';
  reason?: string;
  result?: { identical: boolean; divergenceCount: number; divergences: unknown[] };
};

type StatBlock = { min: number; avg: number; p50: number; p95: number; max: number; count: number };

type BenchmarkReport = {
  meta: { timestamp: string; url: string; requestedDurationMs: number; frameRateHz: number };
  verdicts?: { id: string; status: string; reason: string }[];
  metrics: {
    wallMs: number;
    bootstrap: { sequence: number; opCount: number; bytes: number; tableSize: number; buildMs: number } | null;
    steadyFrameCount: number;
    steadyFps: number;
    buildMs: StatBlock;
    opCount: StatBlock;
    bytes: StatBlock;
    applyMs: StatBlock;
    lastTableSize: number;
    wireBytesTotal: number;
    applyOk: number;
    applyFail: number;
    desyncCount: number;
    applyOverrunCount: number;
    transportDeferredCount: number;
  };
  cpuProfile: { summary: { ourCode: { totalPct: number; totalMs: number }; totalSamples: number; wallMs: number } } | null;
  invariants: { id: string; description: string; passCount: number; failCount: number }[] | null;
  structuralDiff:
    | { status: 'ok'; result: { identical: boolean; divergenceCount: number } }
    | { status: 'unavailable'; reason: string }
    | null;
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

function logActivity(text: string, kind = 'info'): void {
  const log = $('activity');
  const line = document.createElement('div');
  line.dataset.kind = kind;
  line.textContent = `${new Date().toISOString().slice(11, 23)} ${text}`;
  log.prepend(line);
  while (log.childElementCount > 400) log.lastChild?.remove();
}

function setStatus(text: string): void {
  $('status').textContent = text;
}

function defaultFixtureUrl(): string {
  return `${location.origin}/fixtures/demo.html`;
}

function readConfigFromUi(): Record<string, unknown> {
  return {
    enabled: ($('telEnabled') as HTMLInputElement).checked,
    frameEmitted: ($('telFrameEmitted') as HTMLInputElement).checked,
    transportDeferred: ($('telDeferred') as HTMLInputElement).checked,
    aggregate: ($('telAggregate') as HTMLInputElement).checked,
    applyResult: ($('telApply') as HTMLInputElement).checked,
    desync: ($('telDesync') as HTMLInputElement).checked,
    applyOverrun: ($('telOverrun') as HTMLInputElement).checked,
    clock: ($('telClock') as HTMLInputElement).checked,
    aggregateIntervalMs: Number(($('telAggMs') as HTMLInputElement).value) || 2000,
  };
}

function fmtStat(label: string, s: StatBlock, unit = ''): string {
  return `  ${label.padEnd(9)} min=${s.min.toFixed(2)}${unit} avg=${s.avg.toFixed(2)}${unit} p50=${s.p50.toFixed(2)}${unit} p95=${s.p95.toFixed(2)}${unit} max=${s.max.toFixed(2)}${unit}  (n=${s.count})`;
}

function renderBenchmarkReport(report: BenchmarkReport): string {
  const m = report.metrics;
  const lines: string[] = [];
  lines.push(`${report.meta.url}`);
  if (report.verdicts && report.verdicts.length > 0) {
    lines.push('verdicts:');
    for (const v of report.verdicts) lines.push(`  ${v.status.toUpperCase()} ${v.id}: ${v.reason}`);
  }
  lines.push(`wallMs=${m.wallMs.toFixed(0)}  steadyFrames=${m.steadyFrameCount} (~${m.steadyFps.toFixed(1)}fps)  lastTableSize=${m.lastTableSize}  wireBytes=${m.wireBytesTotal}`);
  if (m.bootstrap) {
    lines.push(`bootstrap: seq=${m.bootstrap.sequence} opCount=${m.bootstrap.opCount} bytes=${m.bootstrap.bytes} tableSize=${m.bootstrap.tableSize} buildMs=${m.bootstrap.buildMs.toFixed(2)}`);
  }
  lines.push('steady-state:');
  lines.push(fmtStat('buildMs', m.buildMs, 'ms'));
  lines.push(fmtStat('opCount', m.opCount));
  lines.push(fmtStat('bytes', m.bytes));
  lines.push(fmtStat('applyMs', m.applyMs, 'ms'));
  lines.push(`applyOk=${m.applyOk} applyFail=${m.applyFail} desync=${m.desyncCount} overrun=${m.applyOverrunCount} deferred=${m.transportDeferredCount}`);

  if (report.cpuProfile) {
    const oc = report.cpuProfile.summary.ourCode;
    lines.push(`cpu (Virtual, CDP): our-code=${oc.totalPct.toFixed(2)}% (${oc.totalMs.toFixed(2)}ms of ${report.cpuProfile.summary.wallMs.toFixed(0)}ms, ${report.cpuProfile.summary.totalSamples} samples)`);
  }

  if (report.invariants) {
    const failed = report.invariants.filter((i) => i.failCount > 0);
    lines.push(`invariants: ${report.invariants.length} checks, ${failed.length} with failures`);
    for (const i of failed) lines.push(`  FAIL ${i.id}: ${i.failCount} failures / ${i.passCount} passes`);
  }

  if (report.structuralDiff) {
    if (report.structuralDiff.status === 'ok') {
      const r = report.structuralDiff.result;
      lines.push(`structuralDiff: ${r.identical ? 'identical' : `${r.divergenceCount} divergence(s)`}`);
    } else {
      lines.push(`structuralDiff: unavailable (${report.structuralDiff.reason})`);
    }
  }

  return lines.join('\n');
}

/**
 * Lab-only test introspection (frame-protocol-production-completeness Stage 2 gate,
 * `scripts/smoke-projection-lab.js`) — every field is optional/no-op until a test wires it up.
 * Not part of the wire protocol or any production path; exists so an external Playwright-driven
 * test can (a) read the client's own sequence counter, (b) push a hand-crafted control message
 * over the same session WS the page already uses, and (c) observe the real client's `onDesync`
 * callback fire — without reaching into `bootLabClient`'s otherwise-private closure state.
 */
type SpeculumLabTestHooks = {
  onDesync?: (reason: string) => void;
  sendControl?: (message: Record<string, unknown>) => void;
  projection?: LabProjectionClient;
  /**
   * Fires for every parsed session-control message this page receives, in addition to (not
   * instead of) whatever the ordinary handler below already does with it — lets a test observe a
   * control message type this page has no dedicated UI reaction to (Stage 4's
   * `structuralDiffResult`, for one) without adding bespoke UI plumbing for a test-only signal.
   */
  onControlMessage?: (message: ControlMessage) => void;
};
const speculumLabTestHooks: SpeculumLabTestHooks = {};
(globalThis as unknown as { __speculumLabTestHooks: SpeculumLabTestHooks }).__speculumLabTestHooks =
  speculumLabTestHooks;

function clientKindEnabled(kind: string): boolean {
  if (kind === 'desynced') return ($('telDesync') as HTMLInputElement).checked;
  if (kind === 'applyOverrun') return ($('telOverrun') as HTMLInputElement).checked;
  if (kind === 'parityFingerprint') return true;
  if (kind === 'applyResult') return ($('telApply') as HTMLInputElement).checked;
  return true;
}

export function bootLabClient(): void {
  const urlInput = $('url') as HTMLInputElement;
  urlInput.value = defaultFixtureUrl();

  let ws: WebSocket | null = null;
  let frames = 0;
  let applyOk = 0;
  let desyncCount = 0;
  let resyncCount = 0;
  let opsTotal = 0;
  let lastBuildMs = 0;

  const projection = new LabProjectionClient({
    surfaceHost: $('surfaceHost'),
    onArmed: () => {
      setStatus('armed — live apply');
      logActivity('first frame applied', 'applyResult');
    },
    onDesync: (reason) => {
      desyncCount += 1;
      $('streamDesync').textContent = String(desyncCount);
      setStatus(`desync: ${reason}`);
      logActivity(`desync ${reason}`, 'desynced');
      speculumLabTestHooks.onDesync?.(reason);
    },
    // Stage 4 (frame-protocol-production-completeness) §5.8 — the client's own recovery
    // mechanism has no transport of its own; relay its request over the same session control
    // WS `injectRawFrame`/`clientTelemetry` already use, to `lab/session.ts`'s `requestResync`
    // case, which forwards it onto `PlaneChannel.Control` for the Virtual page to answer.
    onRequestResync: (info) => {
      logActivity(`resync requested reason=${info.reason} gen=${info.generation} seq=${info.sequence}`, 'resyncRequested');
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'requestResync', ...info }));
      }
    },
    onTelemetry: (msg) => {
      const kind = String(msg.kind ?? 'applyResult');
      const send = clientKindEnabled(kind);
      if ((kind === 'desynced' || msg.ok === false) || send) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'clientTelemetry', message: msg }));
        }
      }
      if (msg.ok === true) applyOk += 1;
      $('streamApply').textContent = String(applyOk);
      if (kind === 'resyncCompleted') {
        resyncCount += 1;
        $('streamResync').textContent = String(resyncCount);
      }
      if (typeof msg.opCount === 'number') {
        opsTotal += msg.opCount;
        $('streamOps').textContent = String(opsTotal);
      }
      if (typeof msg.applyMs === 'number') {
        $('streamApplyMs').textContent = msg.applyMs.toFixed(2);
      }
      logActivity(
        `${kind} ok=${String(msg.ok ?? '-')} seq=${String(msg.sequence ?? '-')} ops=${String(msg.opCount ?? '-')} ${msg.reason ? msg.reason : ''}`,
        kind,
      );
    },
  });
  speculumLabTestHooks.projection = projection;
  speculumLabTestHooks.sendControl = (message) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };

  const connectBtn = $('connect') as HTMLButtonElement;
  const startBtn = $('start') as HTMLButtonElement;
  const stopBtn = $('stop') as HTMLButtonElement;
  const runBenchmarkBtn = $('runBenchmark') as HTMLButtonElement;

  function setConnected(on: boolean): void {
    connectBtn.disabled = on;
    startBtn.disabled = !on;
    stopBtn.disabled = !on;
    runBenchmarkBtn.disabled = !on;
  }

  function showTab(name: string): void {
    for (const id of ['panelStream', 'panelActivity', 'panelConfig', 'panelRun']) {
      $(id).hidden = id !== `panel${name}`;
    }
    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      btn.classList.toggle('active', btn.dataset.tab === name);
    }
  }

  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    btn.addEventListener('click', () => showTab(btn.dataset.tab ?? 'Stream'));
  }
  showTab('Stream');

  connectBtn.addEventListener('click', () => {
    if (ws !== null) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/lab/session`);
    ws.binaryType = 'arraybuffer';
    setStatus('connecting…');
    ws.addEventListener('open', () => {
      setConnected(true);
      setStatus('connected — press Start');
      logActivity('session WS open');
    });
    ws.addEventListener('close', () => {
      ws = null;
      setConnected(false);
      setStatus('disconnected');
      logActivity('session WS closed');
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') {
        frames += 1;
        $('streamFrames').textContent = String(frames);
        projection.ingest(new Uint8Array(ev.data as ArrayBuffer));
        return;
      }
      let msg: ControlMessage;
      try {
        msg = JSON.parse(ev.data) as ControlMessage;
      } catch {
        logActivity(`bad control: ${ev.data.slice(0, 80)}`);
        return;
      }
      speculumLabTestHooks.onControlMessage?.(msg);
      if (msg.type === 'hello') {
        logActivity(`hello session=${msg.sessionId ?? '?'}`);
        return;
      }
      if (msg.type === 'ready') {
        setStatus(`Virtual ready — ${msg.url ?? ''}`);
        logActivity(`ready dataPlane=${msg.dataPlaneUrl ?? ''}`);
        return;
      }
      if (msg.type === 'stats') {
        $('hostStats').textContent =
          `host frames=${msg.frames ?? 0} bytes=${msg.bytes ?? 0} gen=${msg.generation ?? '-'} seq=${msg.sequence ?? '-'} tel=${msg.telemetryMessages ?? 0}`;
        if (msg.sequence != null) $('streamSeq').textContent = String(msg.sequence);
        if (msg.generation != null) $('streamGen').textContent = String(msg.generation);
        return;
      }
      if (msg.type === 'telemetry') {
        const tel = msg.message as TelMsg | undefined;
        const kind = tel?.kind ?? '?';
        logActivity(`telemetry ${kind} ${JSON.stringify(tel).slice(0, 120)}`, kind);
        if (kind === 'frameEmitted') {
          if (tel?.sequence != null) $('streamSeq').textContent = String(tel.sequence);
          if (typeof tel?.buildMs === 'number') {
            lastBuildMs = tel.buildMs;
            $('streamBuildMs').textContent = lastBuildMs.toFixed(2);
          }
        }
        return;
      }
      if (msg.type === 'error') {
        setStatus(`error: ${typeof msg.message === 'string' ? msg.message : '?'}`);
        logActivity(`error ${typeof msg.message === 'string' ? msg.message : '?'}`);
        if (runBenchmarkBtn.disabled) {
          runBenchmarkBtn.disabled = false;
          $('benchStatus').textContent = `error: ${typeof msg.message === 'string' ? msg.message : '?'}`;
        }
        return;
      }
      if (msg.type === 'requestSnapshot') {
        const tree = snapshotTree(projection.document);
        const tableSnap = projection.snapshotTable();
        ws?.send(JSON.stringify({ type: 'snapshotResult', tree, table: tableSnap.table, sequence: tableSnap.sequence }));
        logActivity('snapshot captured — sent to session');
        return;
      }
      if (msg.type === 'benchmarkStarted') {
        runBenchmarkBtn.disabled = true;
        $('benchStatus').textContent = `running — ${msg.url ?? ''} for ${msg.durationMs ?? '?'}ms…`;
        $('benchResults').textContent = '';
        logActivity(`benchmark started ${msg.url ?? ''} durationMs=${msg.durationMs ?? '?'}`);
        return;
      }
      if (msg.type === 'benchmarkComplete') {
        runBenchmarkBtn.disabled = false;
        $('benchStatus').textContent = `done — report: ${msg.reportDir ?? '?'}`;
        $('benchResults').textContent = msg.report ? renderBenchmarkReport(msg.report) : '(no report)';
        logActivity(`benchmark complete reportDir=${msg.reportDir ?? '?'}`);
        return;
      }
      logActivity(`control ${msg.type}`);
    });
  });

  startBtn.addEventListener('click', () => {
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    frames = 0;
    applyOk = 0;
    desyncCount = 0;
    resyncCount = 0;
    opsTotal = 0;
    $('streamDesync').textContent = '0';
    $('streamResync').textContent = '0';
    $('streamOps').textContent = '0';
    ws.send(
      JSON.stringify({
        type: 'start',
        url: urlInput.value.trim(),
        telemetry: readConfigFromUi(),
        frameRateHz: Number(($('cfgFrameRate') as HTMLInputElement).value) || 60,
      }),
    );
    setStatus('starting Virtual…');
  });

  stopBtn.addEventListener('click', () => {
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'stop' }));
  });

  runBenchmarkBtn.addEventListener('click', () => {
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    runBenchmarkBtn.disabled = true;
    $('benchStatus').textContent = 'starting…';
    ws.send(
      JSON.stringify({
        type: 'runBenchmark',
        url: urlInput.value.trim(),
        durationMs: Number(($('benchDurationMs') as HTMLInputElement).value) || 15_000,
        telemetry: readConfigFromUi(),
        frameRateHz: Number(($('cfgFrameRate') as HTMLInputElement).value) || 60,
        options: {
          cpuProfile: ($('benchCpuProfile') as HTMLInputElement).checked,
          invariants: ($('benchInvariants') as HTMLInputElement).checked,
          structuralDiff: ($('benchStructuralDiff') as HTMLInputElement).checked,
          isomorphism: ($('benchIso') as HTMLInputElement).checked,
        },
      }),
    );
  });

  setConnected(false);
  setStatus('idle');
}

bootLabClient();
