/**
 * One lab session: client control WS + V4 BrowserSession. Relays frames + telemetry. No Chromium here.
 */

import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { BrowserSession, BrowserSessionEvents } from '../../../BrowserSession';
import {
  LAB_TELEMETRY_DEFAULTS,
  isProjectionTelemetryMessage,
  type ProjectionTelemetryMessage,
} from '../models/telemetry';
import type { TreeNode } from '../models/treeNode';
import type { ReplicatedTableDigest } from '../models/tableDigest';
import type { ClientStateSnapshot } from './isomorphism';
import { createV4ProjectionBrowserSessionFactory } from '../session/V4ProjectionBrowserSession';
import { v4LabLaunchOptions } from '../session/v4LabLaunch';
import { createRunCollectors, executeLabRun, type LabRunRequest } from './runTools';

export type LabSessionOptions = {
  publicOrigin: string;
  publicWsOrigin: string;
  headless: boolean;
};

type StartControlMessage = {
  type: 'start';
  url?: unknown;
  telemetry?: unknown;
  frameRateHz?: unknown;
};

type RunBenchmarkControlMessage = {
  type: 'runBenchmark';
  url?: unknown;
  durationMs?: unknown;
  frameRateHz?: unknown;
  telemetry?: unknown;
  options?: unknown;
};

export type SessionStats = {
  framesFromVirtual: number;
  bytesFromVirtual: number;
  lastSequence: number | null;
  lastGeneration: number | null;
  telemetryMessages: number;
};

function peekFrameHeader(buf: Buffer): { generation: number; sequence: number } | null {
  if (buf.length < 12) return null;
  if (buf.readUInt16LE(0) !== 0x5050) return null;
  return {
    generation: buf.readUInt32LE(4),
    sequence: buf.readUInt32LE(8),
  };
}

export class LabSession {
  readonly id: string;
  private readonly opts: LabSessionOptions;
  private client: WebSocket | null;
  private session: BrowserSession | null = null;
  private closed = false;
  private injectTelemetry: Record<string, unknown> | undefined;
  private frameRateHz = 60;
  private pendingSnapshot: {
    resolve: (snap: ClientStateSnapshot | null) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private runCollectors: ReturnType<typeof createRunCollectors> | null = null;
  private benchmarkRunning = false;
  private readonly stats: SessionStats = {
    framesFromVirtual: 0,
    bytesFromVirtual: 0,
    lastSequence: null,
    lastGeneration: null,
    telemetryMessages: 0,
  };

  constructor(client: WebSocket, opts: LabSessionOptions) {
    this.id = randomUUID();
    this.client = client;
    this.opts = opts;
    this.sendJson({ type: 'hello', sessionId: this.id });
  }

  /** Kept so older smoke that probes the path still compiles; dataplane is owned by BrowserSession. */
  get virtualDataPath(): string {
    return `/lab/virtual/${this.id}`;
  }

  attachVirtualData(_socket: WebSocket): void {
    _socket.close();
  }

  onProjectionTelemetry(message: ProjectionTelemetryMessage): void {
    this.stats.telemetryMessages += 1;
    this.sendJson({ type: 'telemetry', message });
    this.runCollectors?.observeTelemetry(message);
  }

  async handleClientMessage(raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean): Promise<void> {
    if (isBinary || this.closed) return;
    let msg: unknown;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      this.sendJson({ type: 'error', message: 'invalid JSON control message' });
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;
    const type = (msg as { type?: unknown }).type;
    if (type === 'start') {
      const start = msg as StartControlMessage;
      const url = start.url;
      if (typeof url !== 'string' || url.trim().length === 0) {
        this.sendJson({ type: 'error', message: 'start.url required' });
        return;
      }
      if (start.telemetry !== undefined && typeof start.telemetry === 'object' && start.telemetry !== null) {
        this.injectTelemetry = start.telemetry as Record<string, unknown>;
      }
      if (typeof start.frameRateHz === 'number' && Number.isFinite(start.frameRateHz) && start.frameRateHz > 0) {
        this.frameRateHz = start.frameRateHz;
      }
      await this.start(url.trim());
      return;
    }
    if (type === 'clientTelemetry') {
      const message = (msg as { message?: unknown }).message;
      if (isProjectionTelemetryMessage(message)) this.onProjectionTelemetry(message);
      return;
    }
    if (type === 'navigate') {
      const url = (msg as { url?: unknown }).url;
      if (typeof url !== 'string' || url.trim().length === 0) {
        this.sendJson({ type: 'error', message: 'navigate.url required' });
        return;
      }
      await this.navigate(url.trim());
      return;
    }
    if (type === 'stop') {
      await this.stopBrowser();
      this.sendJson({ type: 'stopped' });
      return;
    }
    if (type === 'runBenchmark') {
      const rb = msg as RunBenchmarkControlMessage;
      const url = rb.url;
      if (typeof url !== 'string' || url.trim().length === 0) {
        this.sendJson({ type: 'error', message: 'runBenchmark.url required' });
        return;
      }
      const durationMs =
        typeof rb.durationMs === 'number' && Number.isFinite(rb.durationMs) && rb.durationMs > 0
          ? rb.durationMs
          : 15_000;
      if (typeof rb.frameRateHz === 'number' && Number.isFinite(rb.frameRateHz) && rb.frameRateHz > 0) {
        this.frameRateHz = rb.frameRateHz;
      }
      if (rb.telemetry !== undefined && typeof rb.telemetry === 'object' && rb.telemetry !== null) {
        this.injectTelemetry = rb.telemetry as Record<string, unknown>;
      }
      const optsRaw = (rb.options ?? {}) as Record<string, unknown>;
      await this.runBenchmark(url.trim(), durationMs, {
        cpuProfile: optsRaw.cpuProfile !== false,
        invariants: optsRaw.invariants !== false,
        structuralDiff: optsRaw.structuralDiff !== false,
        isomorphism: optsRaw.isomorphism === true,
      });
      return;
    }
    if (type === 'injectRawFrame') {
      const bytesBase64 = (msg as { bytesBase64?: unknown }).bytesBase64;
      if (typeof bytesBase64 !== 'string') {
        this.sendJson({ type: 'error', message: 'injectRawFrame.bytesBase64 required' });
        return;
      }
      const client = this.client;
      if (client !== null && client.readyState === client.OPEN) {
        client.send(Buffer.from(bytesBase64, 'base64'), { binary: true });
      }
      return;
    }
    if (type === 'requestResync') {
      const req = msg as { reason?: unknown; generation?: unknown; sequence?: unknown };
      this.session?.sendPageProjectionControl?.({
        type: 'requestResync',
        reason: typeof req.reason === 'string' ? req.reason : 'unknown',
        generation: typeof req.generation === 'number' ? req.generation : null,
        sequence: typeof req.sequence === 'number' ? req.sequence : null,
      });
      return;
    }
    if (type === 'requestStructuralDiff') {
      if (this.session === null) {
        this.sendJson({ type: 'structuralDiffResult', status: 'unavailable', reason: 'no virtual browser running' });
        return;
      }
      const virtual = await this.session.snapshotProjectionVirtual?.({ includeTree: true });
      const clientSnap = await this.requestClientSnapshot();
      if (clientSnap === null || clientSnap.tree === null) {
        this.sendJson({
          type: 'structuralDiffResult',
          status: 'unavailable',
          reason: 'client did not reply to requestSnapshot within 5000ms',
        });
        return;
      }
      if (!virtual?.ok || virtual.tree == null) {
        this.sendJson({
          type: 'structuralDiffResult',
          status: 'unavailable',
          reason: virtual?.reason ?? 'virtual snapshot failed',
        });
        return;
      }
      const { diffTrees } = await import('./structuralDiff');
      this.sendJson({
        type: 'structuralDiffResult',
        status: 'ok',
        result: diffTrees(virtual.tree as TreeNode, clientSnap.tree),
      });
      return;
    }
    if (type === 'requestTableLiveOracle') {
      if (this.session === null) {
        this.sendJson({ type: 'tableLiveOracleResult', status: 'unavailable', reason: 'no virtual browser running' });
        return;
      }
      const o2 = await this.session.compareProjectionTableToLiveDom?.();
      if (!o2?.ok || !o2.result) {
        this.sendJson({
          type: 'tableLiveOracleResult',
          status: 'unavailable',
          reason: o2?.reason ?? 'O2 probe failed',
        });
        return;
      }
      this.sendJson({ type: 'tableLiveOracleResult', status: 'ok', result: o2.result });
      return;
    }
    if (type === 'snapshotResult') {
      const tree = (msg as { tree?: unknown }).tree;
      const tableRaw = (msg as { table?: unknown }).table;
      const pending = this.pendingSnapshot;
      if (pending !== null) {
        this.pendingSnapshot = null;
        clearTimeout(pending.timer);
        const table =
          typeof tableRaw === 'object' &&
          tableRaw !== null &&
          typeof (tableRaw as { rowCount?: unknown }).rowCount === 'number' &&
          typeof (tableRaw as { tableHash?: unknown }).tableHash === 'string'
            ? (tableRaw as ReplicatedTableDigest)
            : null;
        pending.resolve({ tree: (tree as TreeNode) ?? null, table });
      }
      return;
    }
    this.sendJson({ type: 'error', message: `unknown control type: ${String(type)}` });
  }

  async requestClientSnapshot(timeoutMs = 5000): Promise<ClientStateSnapshot | null> {
    if (this.client === null || this.client.readyState !== this.client.OPEN) return null;
    if (this.pendingSnapshot !== null) return null;
    return new Promise<ClientStateSnapshot | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingSnapshot = null;
        resolve(null);
      }, timeoutMs);
      this.pendingSnapshot = { resolve, timer };
      this.sendJson({ type: 'requestSnapshot' });
    });
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.stopBrowser();
    this.client = null;
    if (this.pendingSnapshot !== null) {
      clearTimeout(this.pendingSnapshot.timer);
      this.pendingSnapshot.resolve(null);
      this.pendingSnapshot = null;
    }
  }

  private browserEvents(): BrowserSessionEvents {
    return {
      onVideoFrame: () => undefined,
      onAudioFrame: () => undefined,
      onPageProjectionDiff: (diff) => {
        this.onVirtualFrame(Buffer.from(diff.body));
      },
      onPageProjectionTelemetry: (message) => {
        this.onProjectionTelemetry(message);
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

  private async start(url: string): Promise<void> {
    await this.stopBrowser();
    const factory = createV4ProjectionBrowserSessionFactory({ headless: this.opts.headless });
    const session = factory.create(this.id, this.browserEvents());
    this.session = session;
    try {
      await session.launch(
        v4LabLaunchOptions({
          frameRateHz: this.frameRateHz,
          projectionTelemetry: (this.injectTelemetry ?? { ...LAB_TELEMETRY_DEFAULTS }) as LabRunRequest['telemetry'],
          cpuProfiling: true,
        }),
      );
      await session.navigate(url);
      this.sendJson({
        type: 'ready',
        sessionId: this.id,
        url,
        dataPlaneUrl: 'session-owned',
      });
    } catch (err) {
      await session.dispose();
      this.session = null;
      this.sendJson({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async navigate(url: string): Promise<void> {
    if (this.session === null) {
      await this.start(url);
      return;
    }
    try {
      await this.session.navigate(url);
      this.sendJson({ type: 'navigated', url });
    } catch (err) {
      this.sendJson({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async runBenchmark(
    url: string,
    durationMs: number,
    options: { cpuProfile: boolean; invariants: boolean; structuralDiff: boolean; isomorphism: boolean },
  ): Promise<void> {
    if (this.benchmarkRunning) {
      this.sendJson({ type: 'error', message: 'a benchmark is already running on this session' });
      return;
    }
    this.benchmarkRunning = true;
    this.sendJson({ type: 'benchmarkStarted', url, durationMs, options });
    try {
      await this.start(url);
      const session = this.session;
      if (session === null) {
        this.sendJson({ type: 'error', message: 'benchmark: Virtual failed to start' });
        return;
      }
      const collectors = createRunCollectors();
      this.runCollectors = collectors;
      const result = await executeLabRun(
        {
          session,
          observeFrameBytes: collectors.observeFrameBytes,
          observeTelemetry: collectors.observeTelemetry,
          requestClientSnapshot: () => this.requestClientSnapshot(5_000),
        },
        {
          url,
          durationMs,
          frameRateHz: this.frameRateHz,
          telemetry: (this.injectTelemetry ?? { ...LAB_TELEMETRY_DEFAULTS }) as LabRunRequest['telemetry'],
          cpuProfile: options.cpuProfile,
          invariants: options.invariants,
          structuralDiff: options.structuralDiff,
          isomorphism: options.isomorphism,
        },
        collectors,
      );
      this.sendJson({
        type: 'benchmarkComplete',
        report: result.report,
        reportDir: result.written.reportDir,
        reportPath: result.written.reportPath,
      });
    } catch (err) {
      this.sendJson({
        type: 'error',
        message: `benchmark failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      this.runCollectors = null;
      this.benchmarkRunning = false;
    }
  }

  private async stopBrowser(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (session === null) return;
    await session.dispose();
  }

  private onVirtualFrame(buf: Buffer): void {
    this.stats.framesFromVirtual += 1;
    this.stats.bytesFromVirtual += buf.length;
    const header = peekFrameHeader(buf);
    const priorGeneration = this.stats.lastGeneration;
    if (header !== null) {
      this.stats.lastGeneration = header.generation;
      this.stats.lastSequence = header.sequence;
    }
    const client = this.client;
    if (client !== null && client.readyState === client.OPEN) {
      client.send(buf, { binary: true });
    }
    this.runCollectors?.observeFrameBytes(buf);
    const generationChanged = header !== null && this.stats.lastGeneration !== priorGeneration;
    if (this.stats.framesFromVirtual === 1 || this.stats.framesFromVirtual % 15 === 0 || generationChanged) {
      this.sendJson({
        type: 'stats',
        frames: this.stats.framesFromVirtual,
        bytes: this.stats.bytesFromVirtual,
        generation: this.stats.lastGeneration,
        sequence: this.stats.lastSequence,
        telemetryMessages: this.stats.telemetryMessages,
      });
    }
  }

  private sendJson(payload: Record<string, unknown>): void {
    const client = this.client;
    if (client === null || client.readyState !== client.OPEN) return;
    client.send(JSON.stringify(payload));
  }
}
