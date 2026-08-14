/**
 * One lab session: client control WS + Virtual Chromium + Virtual data-plane WS.
 * Relays Frame bytes + Telemetry (JSON) Virtual → Client. No .NET / gRPC.
 */

import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { CDPSession } from 'patchright';
import { PlaneChannel } from '../plane';
import {
  LAB_TELEMETRY_DEFAULTS,
  isProjectionTelemetryMessage,
  type ProjectionTelemetryMessage,
} from '../models/telemetry';
import { NodeDataPlane } from './nodeDataPlane';
import type { ProjectionTelemetrySink } from './projectionTelemetrySink';
import { launchVirtualBrowser, type VirtualBrowserHandle } from './virtualBrowser';
import type { TreeNode } from '../models/treeNode';
import { startCpuProfile, stopCpuProfile } from './cpuProfile';
import { FrameInvariantMonitor } from './frameInvariantMonitor';
import { MetricsAggregator } from './metricsAggregator';
import { captureVirtualSnapshot } from './virtualSnapshot';
import { diffTrees } from './structuralDiff';
import { defaultLabRunsDir, writeRunReport, type BenchmarkReport, type StructuralDiffOutcome } from './runReport';

export type LabSessionOptions = {
  /** Base HTTP origin for fixtures / data-plane URL advertised to Virtual (e.g. http://127.0.0.1:4077). */
  publicOrigin: string;
  /** ws:// origin matching the HTTP server (e.g. ws://127.0.0.1:4077). */
  publicWsOrigin: string;
  headless: boolean;
};

type StartControlMessage = {
  type: 'start';
  url?: unknown;
  telemetry?: unknown;
  frameRateHz?: unknown;
};

type RunBenchmarkOptions = { cpuProfile: boolean; invariants: boolean; structuralDiff: boolean };

type RunBenchmarkControlMessage = {
  type: 'runBenchmark';
  url?: unknown;
  durationMs?: unknown;
  frameRateHz?: unknown;
  telemetry?: unknown;
  options?: unknown;
};

type ActiveBenchmark = {
  metrics: MetricsAggregator;
  invariantMonitor: FrameInvariantMonitor | null;
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

export class LabSession implements ProjectionTelemetrySink {
  readonly id: string;
  private readonly opts: LabSessionOptions;
  private client: WebSocket | null;
  private readonly virtualData = new NodeDataPlane();
  private browser: VirtualBrowserHandle | null = null;
  private closed = false;
  private injectTelemetry: Record<string, unknown> | undefined;
  private frameRateHz = 60;
  private pendingSnapshot: { resolve: (tree: TreeNode | null) => void; timer: ReturnType<typeof setTimeout> } | null =
    null;
  private activeBenchmark: ActiveBenchmark | null = null;
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
    this.virtualData.setHandler((channel, payload) => {
      if (channel === PlaneChannel.Frame) {
        this.onVirtualFrame(Buffer.from(payload));
        return;
      }
      if (channel === PlaneChannel.Telemetry) {
        this.onVirtualTelemetry(payload);
        return;
      }
      // Control: reserved.
    });
    this.sendJson({ type: 'hello', sessionId: this.id });
  }

  get virtualDataPath(): string {
    return `/lab/virtual/${this.id}`;
  }

  /** Lab sink: push telemetry to the client WSS. */
  onProjectionTelemetry(message: ProjectionTelemetryMessage): void {
    this.stats.telemetryMessages += 1;
    this.sendJson({ type: 'telemetry', message });
    this.activeBenchmark?.metrics.observeTelemetry(message);
    this.activeBenchmark?.invariantMonitor?.observeTelemetry(message);
  }

  attachVirtualData(socket: WebSocket): void {
    if (this.closed) {
      socket.close();
      return;
    }
    this.virtualData.attach(socket);
    this.sendJson({ type: 'virtualDataOpen' });
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
      await this.start(url.trim(), { relaunch: true });
      return;
    }
    if (type === 'clientTelemetry') {
      const message = (msg as { message?: unknown }).message;
      if (isProjectionTelemetryMessage(message)) {
        this.onProjectionTelemetry(message);
      }
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
      const options: RunBenchmarkOptions = {
        cpuProfile: optsRaw.cpuProfile !== false,
        invariants: optsRaw.invariants !== false,
        structuralDiff: optsRaw.structuralDiff !== false,
      };
      await this.runBenchmark(url.trim(), durationMs, options);
      return;
    }
    if (type === 'injectRawFrame') {
      // Lab-only test harness hook (frame-protocol-production-completeness Stage 2 gate) —
      // sends caller-supplied bytes to the client verbatim, bypassing Virtual entirely, so a
      // test can hand-craft a deliberately-corrupted frame (wrong preTableHash / bad CHECK) and
      // observe the real client (`client/applyDom.ts`) abort it before touching the DOM. Not
      // part of the wire protocol or any production path — purely drives the already-running
      // client with test-controlled bytes, the same way `requestSnapshot` reads it out.
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
    if (type === 'snapshotResult') {
      const tree = (msg as { tree?: unknown }).tree;
      const pending = this.pendingSnapshot;
      if (pending !== null) {
        this.pendingSnapshot = null;
        clearTimeout(pending.timer);
        pending.resolve((tree as TreeNode) ?? null);
      }
      return;
    }
    this.sendJson({ type: 'error', message: `unknown control type: ${String(type)}` });
  }

  /**
   * Structural diff's client-side half (lab/structuralDiff.ts, component 4) — asks the
   * already-connected lab client to snapshot its surface iframe over the existing control WS,
   * bounded so a client that never answers (closed tab, no client attached) fails the
   * *benchmark step*, not the whole run.
   */
  async requestClientSnapshot(timeoutMs = 5000): Promise<TreeNode | null> {
    if (this.client === null || this.client.readyState !== this.client.OPEN) return null;
    if (this.pendingSnapshot !== null) return null; // one in flight at a time — benchmark orchestration is serial
    return new Promise<TreeNode | null>((resolve) => {
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
    this.virtualData.close();
    this.client = null;
    if (this.pendingSnapshot !== null) {
      clearTimeout(this.pendingSnapshot.timer);
      this.pendingSnapshot.resolve(null);
      this.pendingSnapshot = null;
    }
  }

  private onVirtualTelemetry(payload: Uint8Array): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return;
    }
    if (!isProjectionTelemetryMessage(parsed)) return;
    this.onProjectionTelemetry(parsed);
  }

  private async start(url: string, opts?: { relaunch?: boolean }): Promise<void> {
    if (this.browser !== null && !opts?.relaunch) {
      await this.navigate(url);
      return;
    }
    if (this.browser !== null) {
      await this.stopBrowser();
    }
    const dataPlaneUrl = `${this.opts.publicWsOrigin}${this.virtualDataPath}`;
    try {
      this.browser = await launchVirtualBrowser({
        dataPlaneUrl,
        startUrl: url,
        headless: this.opts.headless,
        frameRateHz: this.frameRateHz,
        telemetry: this.injectTelemetry ?? { ...LAB_TELEMETRY_DEFAULTS },
      });
      this.sendJson({
        type: 'ready',
        sessionId: this.id,
        url,
        dataPlaneUrl,
      });
    } catch (err) {
      this.sendJson({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async navigate(url: string): Promise<void> {
    if (this.browser === null) {
      await this.start(url, { relaunch: true });
      return;
    }
    try {
      await this.browser.navigate(url);
      this.sendJson({ type: 'navigated', url });
    } catch (err) {
      this.sendJson({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Benchmark orchestration (plan component 5): (re)start → start CPU profile + attach the
   * invariant monitor (if enabled) → wait `durationMs` → stop CPU profile → structural
   * snapshot/diff (if enabled) → assemble + write report → reply `benchmarkComplete`. Every
   * step is independently optional per `options` and independently failure-tolerant — a
   * missing client snapshot degrades that one field to `unavailable`, it does not abort the run.
   */
  private async runBenchmark(url: string, durationMs: number, options: RunBenchmarkOptions): Promise<void> {
    if (this.benchmarkRunning) {
      this.sendJson({ type: 'error', message: 'a benchmark is already running on this session' });
      return;
    }
    this.benchmarkRunning = true;
    this.sendJson({ type: 'benchmarkStarted', url, durationMs, options });

    try {
      await this.start(url, { relaunch: true });
      const browser = this.browser;
      if (browser === null) {
        this.sendJson({ type: 'error', message: 'benchmark: Virtual failed to start' });
        return;
      }

      const metrics = new MetricsAggregator();
      const invariantMonitor = options.invariants ? new FrameInvariantMonitor() : null;
      this.activeBenchmark = { metrics, invariantMonitor };

      let cdp: CDPSession | null = null;
      if (options.cpuProfile) {
        cdp = await browser.cdp();
        await startCpuProfile(cdp);
      }

      const startedAt = Date.now();
      await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
      const wallMs = Date.now() - startedAt;

      const cpuProfileResult = cdp !== null ? await stopCpuProfile(cdp, 20) : null;

      let structuralDiff: StructuralDiffOutcome | null = null;
      if (options.structuralDiff) {
        if (this.browser === null) {
          structuralDiff = { status: 'unavailable', reason: 'Virtual stopped before the structural snapshot ran' };
        } else {
          const virtualTree = await captureVirtualSnapshot(this.browser.page);
          const clientTree = await this.requestClientSnapshot(5_000);
          structuralDiff =
            clientTree === null
              ? { status: 'unavailable', reason: 'client did not reply to requestSnapshot within 5000ms' }
              : { status: 'ok', result: diffTrees(virtualTree, clientTree) };
        }
      }

      const report: BenchmarkReport = {
        meta: {
          timestamp: new Date(startedAt).toISOString(),
          url,
          requestedDurationMs: durationMs,
          frameRateHz: this.frameRateHz,
          options,
        },
        metrics: metrics.getSummary(wallMs),
        cpuProfile: cpuProfileResult ? { summary: cpuProfileResult.summary, profileFile: 'profile.cpuprofile' } : null,
        invariants: invariantMonitor?.getSummary() ?? null,
        structuralDiff,
      };

      const written = await writeRunReport(defaultLabRunsDir(), report, cpuProfileResult?.raw ?? null);
      this.sendJson({ type: 'benchmarkComplete', report, reportDir: written.reportDir, reportPath: written.reportPath });
    } catch (err) {
      this.sendJson({
        type: 'error',
        message: `benchmark failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      this.activeBenchmark = null;
      this.benchmarkRunning = false;
    }
  }

  private async stopBrowser(): Promise<void> {
    const handle = this.browser;
    this.browser = null;
    if (handle === null) return;
    await handle.close();
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
    this.activeBenchmark?.metrics.observeWireBytes(buf.length);
    this.activeBenchmark?.invariantMonitor?.observeFrameBytes(buf);
    // §1.2/§4.1 EPOCH_RESET (Stage 3) must be observable the moment it happens, not only on the
    // periodic every-15th-frame cadence below — a fixture with few/no mutations after a hard
    // navigation (e.g. an establish-only page) could otherwise never accumulate 15 more frames,
    // leaving the lab UI (and this session's own telemetry) reporting the *previous* generation
    // indefinitely (found via the smoke suite's EPOCH_RESET gate, 2026-08-14).
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
