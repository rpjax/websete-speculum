/**
 * Lab chassis — Virtual lifecycle, sinks, dossier bind. Caller of BrowserSession only.
 */

import { randomUUID } from 'node:crypto';
import type { BrowserSession, BrowserSessionEvents } from '../../../../BrowserSession';
import {
  LAB_TELEMETRY_DEFAULTS,
  isProjectionTelemetryMessage,
  type ProjectionTelemetryConfig,
  type ProjectionTelemetryMessage,
} from '../../models/telemetry';
import { createV4ProjectionBrowserSessionFactory } from '../../session/V4ProjectionBrowserSession';
import { v4LabLaunchOptions } from '../../session/v4LabLaunch';
import {
  createDossier,
  defaultLabRunsDir,
  finalizeDossier,
  urlSlug,
  type DossierHandle,
  writeJson,
  appendTelemetryEvent,
} from '../dossier/write';
import type { LabSessionRecord, LabVerdict } from '../dossier/types';
import { FrameInvariantMonitor } from '../probes/frameInvariantMonitor';
import { MetricsAggregator } from '../probes/metricsAggregator';
import { NodeTableApplier } from '../probes/nodeTableApply';
import type { ClientStateSnapshot } from '../probes/isomorphism';
import { OpCode } from '../../models/opcodes';
import { decodeFramePart, FramePartAssembler, PersistentStringTable } from '../../models/decode';

export type ChassisOptions = {
  headless: boolean;
  outDir?: string;
};

export type ChassisStats = {
  framesFromVirtual: number;
  bytesFromVirtual: number;
  lastSequence: number | null;
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

function peekFrameHeader(buf: Buffer): { generation: number; sequence: number } | null {
  if (buf.length < 12) return null;
  if (buf.readUInt16LE(0) !== 0x5050) return null;
  return {
    generation: buf.readUInt32LE(4),
    sequence: buf.readUInt32LE(8),
  };
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

  readonly stats: ChassisStats = {
    framesFromVirtual: 0,
    bytesFromVirtual: 0,
    lastSequence: null,
    lastGeneration: null,
    telemetryMessages: 0,
  };

  readonly metrics = new MetricsAggregator();
  readonly invariantMonitor = new FrameInvariantMonitor();
  readonly nodeTable = new NodeTableApplier();
  readonly eventCounts: Record<string, number> = {};
  readonly desyncs: unknown[] = [];
  idlePolls = 0;
  resyncPolls = 0;
  sheetsAbortedSum = 0;

  private readonly opWindows = new Map<string, CssomOpWindow>();
  private onFrameRelay: ((buf: Buffer) => void) | null = null;
  private onTelemetryRelay: ((m: ProjectionTelemetryMessage) => void) | null = null;
  /** When true, Virtual frames still update collectors but are not sent to the DOM client. */
  suppressVirtualRelay = false;

  journal: {
    acts: { name: string; ok: boolean; error?: string }[];
    snaps: { id: string; mode: string; result: unknown }[];
    opWindows: Record<string, CssomOpCounts>;
    iso?: unknown;
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
  } = { acts: [], snaps: [], opWindows: {}, injects: [], timeline: [] };

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

  observeFrameBytes(buf: Uint8Array | Buffer): void {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    this.stats.framesFromVirtual += 1;
    this.stats.bytesFromVirtual += b.length;
    const hdr = peekFrameHeader(b);
    if (hdr) {
      this.stats.lastGeneration = hdr.generation;
      this.stats.lastSequence = hdr.sequence;
    }
    this.metrics.observeWireBytes(b.length);
    this.invariantMonitor.observeFrameBytes(b);
    this.nodeTable.observeFrameBytes(b);
    for (const w of this.opWindows.values()) w.observe(b);
    if (!this.suppressVirtualRelay) this.onFrameRelay?.(b);
  }

  observeTelemetry(message: ProjectionTelemetryMessage): void {
    this.stats.telemetryMessages += 1;
    this.metrics.observeTelemetry(message);
    this.invariantMonitor.observeTelemetry(message);
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
      onPageProjectionDiff: (diff) => {
        this.observeFrameBytes(Buffer.from(diff.body));
      },
      onPageProjectionTelemetry: (message) => {
        this.observeTelemetry(message);
      },
      onConsole: () => undefined,
      onLocationChanged: () => undefined,
      onMainFrameNavigationBlocked: () => undefined,
      onEditableFocusChanged: () => undefined,
      onCameraPermissionRequested: async () => 'deny',
      onMicrophonePermissionRequested: async () => 'deny',
      onCrash: () => undefined,
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
  }): Promise<LabSessionRecord> {
    if (this.session) await this.disposeVirtual();

    this.frameRateHz = opts.frameRateHz ?? 60;
    this.telemetry = {
      ...LAB_TELEMETRY_DEFAULTS,
      ...(opts.telemetry as Partial<ProjectionTelemetryConfig> | undefined),
    };
    this.cpuProfiling = opts.cpuProfiling === true;
    this.idlePolls = 0;
    this.resyncPolls = 0;
    this.sheetsAbortedSum = 0;
    this.journal = { acts: [], snaps: [], opWindows: {}, injects: [], timeline: [] };
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

    const factory = createV4ProjectionBrowserSessionFactory({ headless: this.opts.headless });
    this.session = factory.create(sessionId, this.browserEvents());
    await this.session.launch(
      v4LabLaunchOptions({
        frameRateHz: this.frameRateHz,
        projectionTelemetry: this.telemetry,
        cpuProfiling: this.cpuProfiling,
      }),
    );
    await this.session.navigate(opts.url);
    record.url = opts.url;
    record.status = opts.mode === 'run' ? 'running' : 'live';
    await writeJson(this.dossier, 'session.json', record, 'session');
    return record;
  }

  async navigate(url: string): Promise<void> {
    if (!this.session || !this.record) throw new Error('chassis not booted');
    await this.session.navigate(url);
    this.record.url = url;
    if (this.dossier) await writeJson(this.dossier, 'session.json', this.record, 'session');
  }

  async disposeVirtual(): Promise<void> {
    if (this.session) {
      await this.session.dispose();
      this.session = null;
    }
    if (this.record) {
      this.record.status = 'stopped';
    }
  }

  async exportDossier(verdicts: LabVerdict[] = [], wallMs = 0): Promise<string | null> {
    if (!this.dossier || !this.record) return null;
    this.record.status = 'stopped';
    await writeJson(this.dossier, 'wire/invariants.json', this.invariantMonitor.getSummary(), 'wire.invariants');
    await writeJson(this.dossier, 'journal/acts.json', this.journal.acts, 'journal.acts');
    await writeJson(this.dossier, 'journal/timeline.json', this.journal.timeline, 'journal.timeline');
    if (this.journal.injects.length > 0) {
      await writeJson(this.dossier, 'journal/injects.json', this.journal.injects, 'journal.injects');
    }
    if (this.journal.iso) {
      await writeJson(this.dossier, 'probes/iso.json', this.journal.iso, 'probes.iso');
    }
    const { dossierDir } = await finalizeDossier(this.dossier, {
      session: this.record,
      verdicts,
      meta: {
        wallMs,
        url: this.record.url,
        blueprintId: this.record.blueprintId,
        frameRateHz: this.record.frameRateHz,
        options: { cpuProfiling: this.cpuProfiling },
      },
      counts: { ...this.eventCounts },
    });
    return dossierDir;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.disposeVirtual();
  }
}

export function acceptClientTelemetry(message: unknown): ProjectionTelemetryMessage | null {
  return isProjectionTelemetryMessage(message) ? message : null;
}

export type { ClientStateSnapshot };
