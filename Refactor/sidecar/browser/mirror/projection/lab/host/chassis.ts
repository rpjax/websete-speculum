/**
 * Lab chassis — Virtual lifecycle, sinks, dossier bind. Caller of BrowserSession only.
 */

import { randomUUID } from 'node:crypto';
import type { BrowserSession, BrowserSessionEvents, BrowserDeviceProfile, BrowserResizeResult, BrowserFault } from '../../../../BrowserSession';
import {
  LAB_TELEMETRY_DEFAULTS,
  isProjectionTelemetryMessage,
  type ProjectionTelemetryConfig,
  type ProjectionTelemetryMessage,
} from '@speculum/page-projection/core/telemetry';
import { createPageProjectionBrowserSessionFactory } from '../../session/PageProjectionBrowserSession';
import { labLaunchOptions } from '../../session/labLaunch';
import { startCpuProfile, stopCpuProfile, summarizeProfile, type CpuProfile } from '../probes/cpuProfile';
import {
  createDossier,
  defaultLabRunsDir,
  finalizeDossier,
  urlSlug,
  type DossierHandle,
  writeJson,
  writeJsonSync,
  writeBinaryArtifact,
  appendTelemetryEvent,
  appendNdjsonArtifact,
} from '../dossier/write';
import type { LabSessionRecord, LabVerdict } from '../dossier/types';
import { FrameInvariantMonitor } from '../probes/frameInvariantMonitor';
import { MetricsAggregator } from '../probes/metricsAggregator';
import { NodeTableApplier } from '../probes/nodeTableApply';
import type { ClientStateSnapshot } from '../probes/isomorphism';
import { runIsomorphism } from '../probes/isomorphism';
import { foldIsoJournal, type IsoJournal } from '../blueprints/fold/iso';
import { ContextIndex } from './contextIndex';
import { OpCode } from '@speculum/page-projection/core/opcodes';
import { decodeFramePart, peekFrameHeader as peekPpHeader, FramePartAssembler, PersistentStringTable } from '@speculum/page-projection/core/decode';
import { CONTEXT_ID_ROOT } from '@speculum/page-projection/core/frame';

export type LabConsoleEvent = { t: number; level: number; text: string };
export type LabIntentJournalEntry = {
  t: number;
  intent: Record<string, unknown>;
  ok: boolean;
  error?: string;
  mode?: 'A' | 'B' | 'C' | 'OS';
  /** Sidecar dispatch wall ms for this intent. */
  dispatchMs?: number;
  /** Receive − wallClientMs when stamped. */
  clientLagMs?: number;
};
export type BrowseSnapRecord = {
  id: string;
  label?: string;
  t: number;
  iso: unknown;
  allPass: boolean;
};

export type ChassisOptions = {
  headless: boolean;
  outDir?: string;
};

export type ChassisStats = {
  framesFromVirtual: number;
  bytesFromVirtual: number;
  /** Last root-context (contextId 1) frame sequence — CLI inject continuity only. */
  lastSequence: number | null;
  /** Last root-context generation — CLI inject continuity only. */
  lastGeneration: number | null;
  telemetryMessages: number;
};

export type CssomOpCounts = {
  sheetNew: number;
  sheetDrop: number;
  sheetOrder: number;
  ruleNew: number;
  ruleDrop: number;
  ruleSet: number;
};

export class CssomOpWindow {
  enabled = false;
  readonly counts: CssomOpCounts = {
    sheetNew: 0,
    sheetDrop: 0,
    sheetOrder: 0,
    ruleNew: 0,
    ruleDrop: 0,
    ruleSet: 0,
  };
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
    if (assembled === 'missing_part' || assembled === 'malformed' || assembled === null) return;
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

function peekFrameHeader(buf: Buffer): {
  generation: number;
  sequence: number;
  contextId: number;
} | null {
  const peeked = peekPpHeader(buf);
  if (!peeked) return null;
  return { generation: peeked.generation, sequence: peeked.sequence, contextId: peeked.contextId };
}

export type LabCrashRecord = BrowserFault & {
  t: number;
  at: string;
  stack?: string;
  source: 'browser' | 'page' | 'process' | 'lab';
};

/** Last booted chassis — process crash hooks write here before exit. */
let activeChassis: LabChassis | null = null;

export function getActiveLabChassis(): LabChassis | null {
  return activeChassis;
}

export function installLabProcessCrashHooks(): void {
  const sink = (errorCode: string, err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const chassis = activeChassis;
    if (chassis) {
      chassis.recordCrash({
        errorCode,
        phase: 'runtime',
        message,
        source: 'process',
        stack,
      });
      void chassis.emergencyExport().catch(() => undefined);
    }
    console.error(`[projection-lab] ${errorCode}:`, message);
    if (stack) console.error(stack);
    if (chassis?.dossierHandle) {
      console.error(`[projection-lab] crash written → ${chassis.dossierHandle.dir}/crash.json`);
    }
  };
  process.on('unhandledRejection', (reason) => {
    sink('unhandled_rejection', reason);
  });
  process.on('uncaughtException', (err) => {
    sink('uncaught_exception', err);
    process.exitCode = 1;
  });
}

export class LabChassis {
  readonly connectionId: string;
  private readonly opts: ChassisOptions;
  private session: BrowserSession | null = null;
  private record: LabSessionRecord | null = null;
  private dossier: DossierHandle | null = null;
  private frameRateHz = 60;
  private telemetry: ProjectionTelemetryConfig = { ...LAB_TELEMETRY_DEFAULTS };
  private cpuProfiling = false;
  private disposed = false;
  private bootAtMs = 0;
  private crash: LabCrashRecord | null = null;
  private cpuProfileStarted = false;

  readonly stats: ChassisStats = {
    framesFromVirtual: 0,
    bytesFromVirtual: 0,
    lastSequence: null,
    lastGeneration: null,
    telemetryMessages: 0,
  };

  readonly metrics = new MetricsAggregator();
  readonly contextIndex = new ContextIndex();
  private readonly invariantMonitors = new Map<number, FrameInvariantMonitor>();
  /** Root-context wire monitor — legacy alias for CLI folds that expect a single monitor. */
  get invariantMonitor(): FrameInvariantMonitor {
    return this.monitorFor(CONTEXT_ID_ROOT);
  }
  /**
   * Root-only apply mirror for CLI inject folds — tracks the top-level context sequence/table.
   * Nested context frames update per-context invariant monitors but not this applier or
   * `stats.lastSequence` (inject proofs target the root surface).
   */
  readonly nodeTable = new NodeTableApplier();
  readonly eventCounts: Record<string, number> = {};
  readonly desyncs: unknown[] = [];
  idlePolls = 0;
  resyncPolls = 0;
  sheetsAbortedSum = 0;

  private readonly opWindows = new Map<string, CssomOpWindow>();
  private onFrameRelay: ((buf: Buffer) => void) | null = null;
  private onTelemetryRelay: ((m: ProjectionTelemetryMessage) => void) | null = null;
  private onConsoleRelay: ((ev: LabConsoleEvent) => void) | null = null;
  private onFaultRelay: ((fault: LabCrashRecord) => void) | null = null;
  private onDebugRelay: ((probe: Record<string, unknown>) => void) | null = null;
  /** When true, Virtual frames still update collectors but are not sent to the DOM client. */
  suppressVirtualRelay = false;
  private browseSnapSeq = 0;
  /** Bumped on dispose / cancel so in-flight browse snaps abort before write. */
  private browseSnapEpoch = 0;
  /** Captured before disposeVirtual so Stop export still has inject metrics. */
  private lastInputPipelineMetrics: unknown = null;
  /** Client capture counters from browse.stop payload. */
  private lastInputCaptureMetrics: unknown = null;
  private getClientSnapshotFn:
    | ((contextId: number) => Promise<ClientStateSnapshot | null>)
    | null = null;

  private static readonly BROWSE_SNAP_TIMEOUT_MS = 45_000;

  journal: {
    acts: { name: string; ok: boolean; error?: string }[];
    snaps: { id: string; mode: string; result: unknown }[];
    opWindows: Record<string, CssomOpCounts>;
    iso?: unknown;
    browseSnaps: BrowseSnapRecord[];
    browseIso?: unknown;
    intents: LabIntentJournalEntry[];
    consoleCount: number;
    /** Peak nested-document evidence across iso actions (last iso is often post-drop). */
    nestedEvidence?: {
      virtualDocs: number;
      clientDocs: number;
      clientFrameHrefs: string[];
      treeIdenticalWhileNested: boolean;
      treeDivergencesWhileNested: number;
    };
    injects: {
      kind: string;
      skipped?: boolean;
      skipReason?: string;
      sequence?: number | null;
      beforeSeq?: number | null;
      afterSeq?: number | null;
      desynced?: boolean;
      applyError?: string | null;
    }[];
    timeline: {
      actionId: string;
      queue: string;
      startedAt: string;
      endedAt?: string;
      status: string;
      detail?: string;
    }[];
  } = {
    acts: [],
    snaps: [],
    opWindows: {},
    injects: [],
    timeline: [],
    browseSnaps: [],
    intents: [],
    consoleCount: 0,
  };

  constructor(opts: ChassisOptions) {
    this.connectionId = randomUUID();
    this.opts = opts;
  }

  get sessionId(): string | null {
    return this.record?.sessionId ?? null;
  }

  get browser(): BrowserSession | null {
    return this.session;
  }

  get dossierHandle(): DossierHandle | null {
    return this.dossier;
  }

  get sessionRecord(): LabSessionRecord | null {
    return this.record;
  }

  setFrameRelay(fn: ((buf: Buffer) => void) | null): void {
    this.onFrameRelay = fn;
  }

  get hasClientRelay(): boolean {
    return this.onFrameRelay !== null;
  }

  /**
   * Record generation/sequence of a client-only inject without touching Virtual collectors.
   */
  noteClientOnlyFrame(buf: Uint8Array | Buffer): void {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    const hdr = peekFrameHeader(b);
    if (hdr) {
      this.stats.lastGeneration = hdr.generation;
      this.stats.lastSequence = hdr.sequence;
    }
  }

  /**
   * Send bytes on the client relay only — not Virtual, not nodeTable / invariants / op windows.
   * Updates lastSequence so a follow-up inject can stay contiguous with what the client saw.
   */
  relayClientOnlyFrame(buf: Uint8Array | Buffer): void {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    this.noteClientOnlyFrame(b);
    this.onFrameRelay?.(b);
  }

  setTelemetryRelay(fn: ((m: ProjectionTelemetryMessage) => void) | null): void {
    this.onTelemetryRelay = fn;
  }

  setConsoleRelay(fn: ((ev: LabConsoleEvent) => void) | null): void {
    this.onConsoleRelay = fn;
  }

  setFaultRelay(fn: ((fault: LabCrashRecord) => void) | null): void {
    this.onFaultRelay = fn;
  }

  setDebugRelay(fn: ((probe: Record<string, unknown>) => void) | null): void {
    this.onDebugRelay = fn;
  }

  sessionWallMs(now = Date.now()): number {
    return this.bootAtMs > 0 ? Math.max(0, now - this.bootAtMs) : 0;
  }

  get crashRecord(): LabCrashRecord | null {
    return this.crash;
  }

  /**
   * First crash wins. Writes crash.json sync so process-exit still leaves evidence.
   */
  recordCrash(fault: {
    errorCode: string;
    message: string;
    phase?: string;
    source?: LabCrashRecord['source'];
    stack?: string;
  }): LabCrashRecord {
    if (this.crash) return this.crash;
    const at = new Date().toISOString();
    const record: LabCrashRecord = {
      errorCode: fault.errorCode,
      message: fault.message,
      phase: fault.phase,
      t: Date.now(),
      at,
      source: fault.source ?? 'lab',
      stack: fault.stack,
    };
    this.crash = record;
    if (this.record) {
      this.record.status = 'faulted';
      this.record.fault = { message: `${record.errorCode}: ${record.message}`, at };
      if (this.dossier) writeJsonSync(this.dossier, 'session.json', this.record, 'session');
    }
    if (this.dossier) {
      writeJsonSync(this.dossier, 'crash.json', record, 'crash');
    }
    this.onFaultRelay?.(record);
    return record;
  }

  collectDebugProbe(): Record<string, unknown> {
    const session = this.session as {
      getInputPipelineMetrics?: () => unknown;
    } | null;
    const input = session?.getInputPipelineMetrics?.() ?? null;
    const intents = this.journal.intents;
    const intentOk = intents.filter((i) => i.ok).length;
    const intentDrop = intents.length - intentOk;
    const dropsByError: Record<string, number> = {};
    for (const i of intents) {
      if (i.ok || !i.error) continue;
      dropsByError[i.error] = (dropsByError[i.error] ?? 0) + 1;
    }
    return {
      t: Date.now(),
      wallMs: this.sessionWallMs(),
      cpuProfiling: this.cpuProfiling,
      cpuProfileStarted: this.cpuProfileStarted,
      crash: this.crash,
      sessionStatus: this.record?.status ?? null,
      dossierDir: this.dossier?.dir ?? null,
      framesFromVirtual: this.stats.framesFromVirtual,
      bytesFromVirtual: this.stats.bytesFromVirtual,
      telemetryMessages: this.stats.telemetryMessages,
      consoleCount: this.journal.consoleCount,
      intentJournal: {
        total: intents.length,
        ok: intentOk,
        dropped: intentDrop,
        dropsByError,
      },
      inputPipeline: input,
      metrics: this.metrics.getSummary(this.sessionWallMs()),
    };
  }

  pushDebugProbe(): void {
    this.onDebugRelay?.(this.collectDebugProbe());
  }

  /** Best-effort dump when process is dying — metrics + input pipe + crash. */
  async emergencyExport(): Promise<string | null> {
    if (!this.dossier || !this.record) return null;
    try {
      const wallMs = this.sessionWallMs();
      await this.writeBrowseProbes(wallMs);
      await finalizeDossier(this.dossier, {
        session: this.record,
        verdicts: [
          {
            id: 'session.crash',
            status: 'fail',
            reason: this.crash
              ? `${this.crash.errorCode}: ${this.crash.message}`
              : 'emergency export without crash record',
          },
        ],
        meta: {
          wallMs,
          url: this.record.url,
          blueprintId: this.record.blueprintId,
          frameRateHz: this.record.frameRateHz,
          options: {
            cpuProfiling: this.cpuProfiling,
            emergency: true,
            crash: this.crash,
          },
        },
        counts: {
          ...this.eventCounts,
          console: this.journal.consoleCount,
          intent: this.journal.intents.length,
        },
      });
      return this.dossier.dir;
    } catch {
      return this.dossier.dir;
    }
  }

  /** Bind Projected snapshot puller (WS `requestSnapshot` ↔ `client.snapshotResult`). */
  setClientSnapshotProvider(
    fn: ((contextId: number) => Promise<ClientStateSnapshot | null>) | null,
  ): void {
    this.getClientSnapshotFn = fn;
  }

  get browseSnapCount(): number {
    return this.journal.browseSnaps.length;
  }

  observeFrameBytes(buf: Uint8Array | Buffer): void {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    this.stats.framesFromVirtual += 1;
    this.stats.bytesFromVirtual += b.length;
    const hdr = peekFrameHeader(b);
    this.contextIndex.observeFrameHeader(hdr);
    if (hdr) {
      this.monitorFor(hdr.contextId).observeFrameBytes(b);
      if (hdr.contextId === CONTEXT_ID_ROOT) {
        this.stats.lastGeneration = hdr.generation;
        this.stats.lastSequence = hdr.sequence;
        this.nodeTable.observeFrameBytes(b);
        for (const w of this.opWindows.values()) w.observe(b);
      }
    }
    this.metrics.observeWireBytes(b.length);
    if (!this.suppressVirtualRelay) this.onFrameRelay?.(b);
  }

  private monitorFor(contextId: number): FrameInvariantMonitor {
    let monitor = this.invariantMonitors.get(contextId);
    if (!monitor) {
      monitor = new FrameInvariantMonitor();
      this.invariantMonitors.set(contextId, monitor);
    }
    return monitor;
  }

  observeTelemetry(message: ProjectionTelemetryMessage): void {
    this.stats.telemetryMessages += 1;
    this.contextIndex.observeTelemetry(message);
    this.metrics.observeTelemetry(message);
    this.monitorFor(message.contextId).observeTelemetry(message);
    this.eventCounts[message.kind] = (this.eventCounts[message.kind] ?? 0) + 1;
    if (message.kind === 'desynced') this.desyncs.push(message);
    if (message.kind === 'cssomPoll') {
      if (message.source === 'idle') this.idlePolls += 1;
      if (message.source === 'resync') this.resyncPolls += 1;
      this.sheetsAbortedSum += message.sheetsAborted ?? 0;
    }
    if (this.dossier) void appendTelemetryEvent(this.dossier, message);
    this.onTelemetryRelay?.(message);
  }

  startOpWindow(windowId: string): void {
    const w = new CssomOpWindow();
    w.start();
    this.opWindows.set(windowId, w);
  }

  stopOpWindow(windowId: string): CssomOpCounts {
    const w = this.opWindows.get(windowId);
    if (!w) return { sheetNew: 0, sheetDrop: 0, sheetOrder: 0, ruleNew: 0, ruleDrop: 0, ruleSet: 0 };
    w.stop();
    const counts = { ...w.counts };
    this.journal.opWindows[windowId] = counts;
    this.opWindows.delete(windowId);
    if (this.dossier) {
      void writeJson(this.dossier, `wire/op-windows/${windowId}.json`, counts, 'wire.opWindow');
    }
    return counts;
  }

  private browserEvents(): BrowserSessionEvents {
    return {
      onVideoFrame: () => undefined,
      onAudioFrame: () => undefined,
      onPageProjectionFrame: (diff) => {
        this.observeFrameBytes(Buffer.from(diff.body));
      },
      onPageProjectionTelemetry: (message) => {
        this.observeTelemetry(message);
      },
      onConsole: (level, text) => {
        const ev: LabConsoleEvent = { t: Date.now(), level, text };
        this.journal.consoleCount += 1;
        this.eventCounts.console = (this.eventCounts.console ?? 0) + 1;
        if (this.dossier) {
          void appendNdjsonArtifact(this.dossier, 'telemetry/console.ndjson', ev, 'telemetry.console');
        }
        this.onConsoleRelay?.(ev);
      },
      onLocationChanged: () => undefined,
      onMainFrameNavigationBlocked: () => undefined,
      onEditableFocusChanged: () => undefined,
      onCameraPermissionRequested: async () => 'deny',
      onMicrophonePermissionRequested: async () => 'deny',
      onCrash: (fault) => {
        const source: LabCrashRecord['source'] =
          fault.errorCode === 'page_crash'
            ? 'page'
            : fault.errorCode === 'browser_disconnected'
              ? 'browser'
              : 'lab';
        this.recordCrash({
          errorCode: fault.errorCode,
          message: fault.message,
          phase: fault.phase,
          source,
        });
      },
    };
  }

  async boot(opts: {
    mode: 'browse' | 'run';
    url: string;
    frameRateHz?: number;
    telemetry?: Partial<ProjectionTelemetryConfig> | Record<string, unknown>;
    cpuProfiling?: boolean;
    blueprintId?: string | null;
    slug?: string;
    width?: number;
    height?: number;
    device?: BrowserDeviceProfile | Record<string, unknown>;
  }): Promise<LabSessionRecord> {
    if (this.session) await this.disposeVirtual();

    this.frameRateHz = opts.frameRateHz ?? 60;
    this.telemetry = {
      ...LAB_TELEMETRY_DEFAULTS,
      ...(opts.telemetry as Partial<ProjectionTelemetryConfig> | undefined),
    };
    this.cpuProfiling = opts.cpuProfiling === true;
    this.cpuProfileStarted = false;
    this.crash = null;
    this.bootAtMs = Date.now();
    this.metrics.reset();
    this.idlePolls = 0;
    this.resyncPolls = 0;
    this.sheetsAbortedSum = 0;
    this.journal = {
      acts: [],
      snaps: [],
      opWindows: {},
      injects: [],
      timeline: [],
      browseSnaps: [],
      intents: [],
      consoleCount: 0,
    };
    this.browseSnapSeq = 0;
    this.browseSnapEpoch += 1;
    this.contextIndex.noteBoot();
    this.invariantMonitors.clear();
    Object.keys(this.eventCounts).forEach((k) => delete this.eventCounts[k]);
    this.desyncs.length = 0;

    const sessionId = randomUUID();
    const createdAt = new Date().toISOString();
    const slug = opts.slug ?? (opts.blueprintId ? opts.blueprintId : urlSlug(opts.url));
    const baseDir = this.opts.outDir ?? defaultLabRunsDir();

    const record: LabSessionRecord = {
      sessionId,
      mode: opts.mode,
      createdAt,
      url: opts.url,
      frameRateHz: this.frameRateHz,
      headed: !this.opts.headless,
      telemetry: this.telemetry as unknown as Record<string, unknown>,
      cpuProfiling: this.cpuProfiling,
      blueprintId: opts.blueprintId ?? null,
      dossierDir: '',
      status: 'booting',
    };

    this.dossier = await createDossier({
      baseDir,
      createdAt,
      slug,
      session: record,
    });
    record.dossierDir = this.dossier.dir;
    this.record = record;

    const factory = createPageProjectionBrowserSessionFactory({
      headless: this.opts.headless,
      probes: {
        startCpuProfile,
        stopCpuProfile,
      },
    });
    this.session = factory.create(sessionId, this.browserEvents());
    await this.session.launch(
      labLaunchOptions({
        width: opts.width,
        height: opts.height,
        device: opts.device as BrowserDeviceProfile | undefined,
        frameRateHz: this.frameRateHz,
        projectionTelemetry: this.telemetry,
        cpuProfiling: this.cpuProfiling,
      }),
    );
    await this.session.navigate(opts.url);
    record.url = opts.url;
    record.status = opts.mode === 'run' ? 'running' : 'live';
    await writeJson(this.dossier, 'session.json', record, 'session');
    activeChassis = this;
    if (this.cpuProfiling && opts.mode === 'browse') {
      const start = await (this.session as { startCpuProfile?: () => Promise<{ ok: boolean; reason?: string }> })
        .startCpuProfile?.();
      this.cpuProfileStarted = start?.ok === true;
      if (!this.cpuProfileStarted) {
        await writeJson(
          this.dossier,
          'probes/cpu/start-failed.json',
          { ok: false, reason: start?.reason ?? 'startCpuProfile failed' },
          'probes.cpu.startFailed',
        );
      }
    }
    this.pushDebugProbe();
    return record;
  }

  async navigate(url: string): Promise<void> {
    if (!this.session || !this.record) throw new Error('chassis not booted');
    await this.session.navigate(url);
    this.record.url = url;
    if (this.dossier) await writeJson(this.dossier, 'session.json', this.record, 'session');
  }

  async resize(req: {
    width: number;
    height: number;
    device?: BrowserDeviceProfile | Record<string, unknown>;
  }): Promise<BrowserResizeResult> {
    if (!this.session) {
      return {
        ok: false,
        width: 0,
        height: 0,
        errorCode: 'session_not_open',
        phase: 'validate',
        message: 'chassis not booted',
      };
    }
    return this.session.resize({
      width: req.width,
      height: req.height,
      device: req.device as BrowserDeviceProfile | undefined,
    });
  }

  async journalIntent(
    intent: Record<string, unknown>,
    result: {
      ok: boolean;
      error?: string;
      mode?: 'A' | 'B' | 'C' | 'OS';
      dispatchMs?: number;
      clientLagMs?: number;
    },
  ): Promise<void> {
    const entry: LabIntentJournalEntry = {
      t: Date.now(),
      intent,
      ok: result.ok,
      error: result.error,
      mode: result.mode ?? 'OS',
      dispatchMs: result.dispatchMs,
      clientLagMs: result.clientLagMs,
    };
    this.journal.intents.push(entry);
    this.eventCounts.intent = (this.eventCounts.intent ?? 0) + 1;
    // Motion intents are high-rate; keep them in memory for Stop export, skip live ndjson.
    const type = typeof intent.type === 'string' ? intent.type.toLowerCase() : '';
    const motion =
      type === 'move'
      || type === 'mousemove'
      || type === 'pointermove'
      || type === 'wheel'
      || type === 'scrollviewport'
      || type === 'scrollset';
    if (this.dossier && (!motion || !result.ok)) {
      await appendNdjsonArtifact(this.dossier, 'journal/intents.jsonl', entry, 'journal.intents');
    }
  }

  /** Client capture snapshot from browse.stop — written into input-pipeline probe. */
  setInputCaptureMetrics(metrics: unknown): void {
    this.lastInputCaptureMetrics = metrics ?? null;
  }

  /**
   * Browse debug snap: digest/table pair for root + Projected nested contexts.
   * Full tree + cssom scan is blueprint iso only — on live Eneba it pins CDP for tens of seconds.
   */
  async captureBrowseSnap(label?: string): Promise<BrowseSnapRecord> {
    if (!this.session) throw new Error('chassis not booted');
    if (!this.getClientSnapshotFn) throw new Error('client snapshot provider not bound');
    const epoch = this.browseSnapEpoch;
    this.browseSnapSeq += 1;
    const id = `browse-${String(this.browseSnapSeq).padStart(3, '0')}`;
    const contextIds = await this.resolveBrowseSnapContextIds(epoch);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let iso: Awaited<ReturnType<typeof runIsomorphism>>;
    try {
      iso = await Promise.race([
        runIsomorphism({
          session: this.session,
          contextIds,
          getClientSnapshot: (contextId) => this.getClientSnapshotFn!(contextId),
          virtualCapture: {
            table: 'full',
            liveChildOrder: true,
            tree: false,
            cssom: 'none',
            formProps: false,
            frameNewNodes: false,
          },
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`browse snap timed out after ${LabChassis.BROWSE_SNAP_TIMEOUT_MS}ms`)),
            LabChassis.BROWSE_SNAP_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (err) {
      this.browseSnapEpoch += 1;
      throw err;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
    if (epoch !== this.browseSnapEpoch) {
      throw new Error('browse snap cancelled');
    }
    const record: BrowseSnapRecord = {
      id,
      label,
      t: Date.now(),
      iso,
      allPass: iso.allPass === true,
    };
    this.journal.browseSnaps.push(record);
    this.journal.snaps.push({ id, mode: 'browse', result: iso });
    if (this.dossier) {
      await writeJson(this.dossier, `probes/snaps/${id}.json`, record, 'probes.snap');
    }
    return record;
  }

  /** Root always; other wire contexts only when Projected still has a surface for them. */
  private async resolveBrowseSnapContextIds(epoch: number): Promise<number[]> {
    const wire = this.contextIndex.list();
    const candidates = wire.length > 0 ? wire : [CONTEXT_ID_ROOT];
    const out: number[] = [];
    for (const id of candidates) {
      if (epoch !== this.browseSnapEpoch) throw new Error('browse snap cancelled');
      if (id === CONTEXT_ID_ROOT) {
        out.push(id);
        continue;
      }
      const client = await this.getClientSnapshotFn!(id);
      if (client != null) out.push(id);
    }
    if (out.length === 0) out.push(CONTEXT_ID_ROOT);
    return out;
  }

  async validateBrowseSnaps(): Promise<{
    allPass: boolean;
    snapCount: number;
    pass: number;
    fail: number;
    skipped: number;
    verdicts: LabVerdict[];
  }> {
    const snaps = this.journal.browseSnaps;
    const verdicts: LabVerdict[] = [];
    if (snaps.length === 0) {
      verdicts.push({ id: 'browse.iso', status: 'skipped', reason: 'no browse snaps collected' });
    } else {
      for (const snap of snaps) {
        const folded = foldIsoJournal(snap.iso as IsoJournal, { requireDomTree: false });
        for (const v of folded) {
          verdicts.push({
            ...v,
            id: `${snap.id}.${v.id}`,
            reason: `[${snap.id}${snap.label ? ` ${snap.label}` : ''}] ${v.reason ?? ''}`.trim(),
          });
        }
        if (!snap.allPass) {
          verdicts.push({
            id: `${snap.id}.allPass`,
            status: 'fail',
            reason: 'stored snap reported allPass=false',
          });
        }
      }
    }
    const pass = verdicts.filter((v) => v.status === 'pass').length;
    const fail = verdicts.filter((v) => v.status === 'fail').length;
    const skipped = verdicts.filter((v) => v.status === 'skipped').length;
    const allPass = fail === 0 && snaps.length > 0 && snaps.every((s) => s.allPass);
    const summary = {
      allPass,
      snapCount: snaps.length,
      pass,
      fail,
      skipped,
      verdicts,
      snaps: snaps.map((s) => ({
        id: s.id,
        label: s.label,
        t: s.t,
        allPass: s.allPass,
        sequence: (s.iso as { sequence?: number | null } | null)?.sequence ?? null,
        generation: (s.iso as { generation?: number | null } | null)?.generation ?? null,
      })),
    };
    this.journal.browseIso = summary;
    if (this.dossier) {
      await writeJson(this.dossier, 'probes/iso-browse.json', summary, 'probes.isoBrowse');
    }
    return { allPass, snapCount: snaps.length, pass, fail, skipped, verdicts };
  }

  /** Snapshot input inject metrics while Virtual is still alive. */
  captureInputPipelineMetrics(): void {
    const session = this.session as { getInputPipelineMetrics?: () => unknown } | null;
    this.lastInputPipelineMetrics = session?.getInputPipelineMetrics?.() ?? this.lastInputPipelineMetrics;
  }

  async disposeVirtual(): Promise<void> {
    this.captureInputPipelineMetrics();
    // Invalidate in-flight snaps before closing so writers abort; closing the page
    // also unblocks a stuck page.evaluate that would otherwise pin CDP through Stop.
    this.browseSnapEpoch += 1;
    if (activeChassis === this) activeChassis = null;
    if (this.session) {
      if (this.cpuProfileStarted) {
        await this.stopCpuProfileToDossier(3_000);
      }
      await this.session.dispose();
      this.session = null;
    }
    if (this.record && this.record.status !== 'faulted') {
      this.record.status = 'stopped';
    }
  }

  /** Best-effort CPU stop; never blocks teardown longer than `timeoutMs`. */
  private async stopCpuProfileToDossier(timeoutMs: number): Promise<void> {
    if (!this.cpuProfileStarted || !this.session) {
      this.cpuProfileStarted = false;
      return;
    }
    try {
      const stop = await Promise.race([
        (this.session as {
          stopCpuProfile?: () => Promise<{
            ok: boolean;
            profileBytes?: Uint8Array;
            reason?: string;
          }>;
        }).stopCpuProfile?.() ?? Promise.resolve(null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      this.cpuProfileStarted = false;
      if (!this.dossier) return;
      if (stop?.ok && stop.profileBytes) {
        const raw = JSON.parse(new TextDecoder().decode(stop.profileBytes)) as CpuProfile;
        const summary = summarizeProfile(raw, 20);
        await writeJson(this.dossier, 'probes/cpu/summary.json', summary, 'probes.cpu.summary');
        await writeBinaryArtifact(
          this.dossier,
          'probes/cpu/profile.cpuprofile',
          JSON.stringify(raw),
          'probes.cpu.profile',
          'application/json',
        );
      } else if (stop && !stop.ok) {
        await writeJson(
          this.dossier,
          'probes/cpu/stop-failed.json',
          { ok: false, reason: stop.reason ?? 'stopCpuProfile failed' },
          'probes.cpu.stopFailed',
        );
      } else if (!stop) {
        await writeJson(
          this.dossier,
          'probes/cpu/stop-failed.json',
          { ok: false, reason: `stopCpuProfile timed out after ${timeoutMs}ms` },
          'probes.cpu.stopFailed',
        );
      }
    } catch (err) {
      this.cpuProfileStarted = false;
      if (this.dossier) {
        await writeJson(
          this.dossier,
          'probes/cpu/stop-failed.json',
          { ok: false, reason: err instanceof Error ? err.message : String(err) },
          'probes.cpu.stopFailed',
        );
      }
    }
  }

  private async writeBrowseProbes(wallMs: number): Promise<void> {
    if (!this.dossier) return;
    if (this.cpuProfileStarted && this.session) {
      await this.stopCpuProfileToDossier(8_000);
    }

    const metricsSummary = this.metrics.getSummary(wallMs);
    await writeJson(this.dossier, 'probes/metrics.json', metricsSummary, 'probes.metrics');

    const session = this.session as { getInputPipelineMetrics?: () => unknown } | null;
    const inject = session?.getInputPipelineMetrics?.() ?? this.lastInputPipelineMetrics;
    const intents = this.journal.intents;
    const dropsByError: Record<string, number> = {};
    for (const i of intents) {
      if (i.ok || !i.error) continue;
      dropsByError[i.error] = (dropsByError[i.error] ?? 0) + 1;
    }
    const byType: Record<string, number> = {};
    const byMode: Record<string, { total: number; ok: number; dropped: number }> = {};
    const dispatchSamples: number[] = [];
    const lagSamples: number[] = [];
    for (const i of intents) {
      const t = typeof i.intent.type === 'string' ? i.intent.type : 'unknown';
      byType[t] = (byType[t] ?? 0) + 1;
      const mode = i.mode ?? '?';
      let m = byMode[mode];
      if (!m) {
        m = { total: 0, ok: 0, dropped: 0 };
        byMode[mode] = m;
      }
      m.total += 1;
      if (i.ok) m.ok += 1;
      else m.dropped += 1;
      if (typeof i.dispatchMs === 'number' && Number.isFinite(i.dispatchMs)) {
        dispatchSamples.push(i.dispatchMs);
      }
      if (typeof i.clientLagMs === 'number' && Number.isFinite(i.clientLagMs)) {
        lagSamples.push(i.clientLagMs);
      }
    }
    const pct = (samples: number[]) => {
      if (samples.length === 0) return { count: 0, min: 0, avg: 0, p95: 0, max: 0 };
      const sorted = [...samples].sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      const p95Idx = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
      return {
        count: sorted.length,
        min: sorted[0]!,
        avg: sum / sorted.length,
        p95: sorted[p95Idx]!,
        max: sorted[sorted.length - 1]!,
      };
    };
    await writeJson(
      this.dossier,
      'probes/input-pipeline.json',
      {
        wallMs,
        backend: 'os',
        path: 'eventApplier+absUinput',
        capture: this.lastInputCaptureMetrics,
        journal: {
          total: intents.length,
          ok: intents.filter((x) => x.ok).length,
          dropped: intents.filter((x) => !x.ok).length,
          dropsByError,
          byType,
          byMode,
          dispatchMs: pct(dispatchSamples),
          clientLagMs: pct(lagSamples),
        },
        dispatch: inject,
        crash: this.crash,
      },
      'probes.inputPipeline',
    );

    if (this.crash) {
      writeJsonSync(this.dossier, 'crash.json', this.crash, 'crash');
    }
  }

  async exportDossier(verdicts: LabVerdict[] = [], wallMs = 0): Promise<string | null> {
    if (!this.dossier || !this.record) return null;
    if (this.record.status !== 'faulted') this.record.status = 'stopped';
    const effectiveWallMs = wallMs > 0 ? wallMs : this.sessionWallMs();
    // Auto-validate browse snaps on Stop when any were collected and not yet folded.
    let exportVerdicts = [...verdicts];
    if (this.journal.browseSnaps.length > 0 && !this.journal.browseIso) {
      const validated = await this.validateBrowseSnaps();
      exportVerdicts = [...exportVerdicts, ...validated.verdicts];
    } else if (this.journal.browseIso && typeof this.journal.browseIso === 'object') {
      const prior = this.journal.browseIso as { verdicts?: LabVerdict[] };
      if (Array.isArray(prior.verdicts) && exportVerdicts.length === 0) {
        exportVerdicts = [...prior.verdicts];
      }
    }
    if (this.crash) {
      exportVerdicts.push({
        id: 'session.crash',
        status: 'fail',
        reason: `${this.crash.errorCode}: ${this.crash.message}`,
      });
    }
    await this.writeBrowseProbes(effectiveWallMs);
    await writeJson(this.dossier, 'wire/invariants.json', this.invariantsDossier(), 'wire.invariants');
    await writeJson(this.dossier, 'journal/contexts.json', this.contextIndex.toJSON(), 'journal.contexts');
    await writeJson(this.dossier, 'journal/acts.json', this.journal.acts, 'journal.acts');
    await writeJson(this.dossier, 'journal/timeline.json', this.journal.timeline, 'journal.timeline');
    if (this.journal.injects.length > 0) {
      await writeJson(this.dossier, 'journal/injects.json', this.journal.injects, 'journal.injects');
    }
    if (this.journal.intents.length > 0) {
      await writeJson(this.dossier, 'journal/intents.json', this.journal.intents, 'journal.intents');
    }
    if (this.journal.iso) {
      await writeJson(this.dossier, 'probes/iso.json', this.journal.iso, 'probes.iso');
    }
    if (this.journal.browseIso) {
      await writeJson(this.dossier, 'probes/iso-browse.json', this.journal.browseIso, 'probes.isoBrowse');
    }
    if (this.journal.browseSnaps.length > 0) {
      await writeJson(
        this.dossier,
        'probes/browse-snaps-index.json',
        this.journal.browseSnaps.map((s) => ({
          id: s.id,
          label: s.label,
          t: s.t,
          allPass: s.allPass,
        })),
        'probes.browseSnapsIndex',
      );
    }
    const { dossierDir } = await finalizeDossier(this.dossier, {
      session: this.record,
      verdicts: exportVerdicts,
      meta: {
        wallMs: effectiveWallMs,
        url: this.record.url,
        blueprintId: this.record.blueprintId,
        frameRateHz: this.record.frameRateHz,
        options: {
          cpuProfiling: this.cpuProfiling,
          browseSnapCount: this.journal.browseSnaps.length,
          consoleCount: this.journal.consoleCount,
          intentCount: this.journal.intents.length,
          crash: this.crash,
        },
      },
      counts: {
        ...this.eventCounts,
        console: this.journal.consoleCount,
        intent: this.journal.intents.length,
        browseSnap: this.journal.browseSnaps.length,
        intentDropped: this.journal.intents.filter((i) => !i.ok).length,
      },
    });
    return dossierDir;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.disposeVirtual();
  }

  private invariantsDossier(): {
    root: ReturnType<FrameInvariantMonitor['getSummary']>;
    byContext: Record<string, ReturnType<FrameInvariantMonitor['getSummary']>>;
  } {
    const byContext: Record<string, ReturnType<FrameInvariantMonitor['getSummary']>> = {};
    for (const [id, monitor] of this.invariantMonitors) {
      byContext[String(id)] = monitor.getSummary();
    }
    return { root: this.monitorFor(CONTEXT_ID_ROOT).getSummary(), byContext };
  }
}

export function acceptClientTelemetry(message: unknown): ProjectionTelemetryMessage | null {
  return isProjectionTelemetryMessage(message) ? message : null;
}

export type { ClientStateSnapshot };
