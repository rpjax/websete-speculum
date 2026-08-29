/**
 * Lab WS connection — Browse + Run over protocol v1.
 */

import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { TreeNode } from '@speculum/page-projection/core/treeNode';
import type { ReplicatedTableDigest } from '@speculum/page-projection/core/tableDigest';
import { LAB_TELEMETRY_DEFAULTS } from '@speculum/page-projection/core/telemetry';
import { LabChassis, acceptClientTelemetry, type ClientStateSnapshot } from './chassis';
import { LAB_PROTOCOL_VERSION, parseClientMessage, type LabHostMessage } from './protocol';
import { loadBlueprint } from '../runner/loadBlueprint';
import { executeBlueprint } from '../runner/execute';
import { labAssetRoots } from '../assetRoots';
import { reportExitCode } from '../dossier/types';
import { captureProjectedViewportClip } from './labProjectedCapture';

export type WsLabOptions = {
  headless: boolean;
  publicOrigin: string;
};

type SnapshotRequest = {
  contextId: number;
  timeoutMs: number;
  options?: {
    includeNestedPeek?: boolean;
    registryProbeNodeIds?: number[];
    rectLadderProbe?: { nestedContextId: number; widgetNodeId?: number };
    paintProbe?: {
      nestedContextId: number;
      widgetNodeId?: number;
    };
    cssomSheetDump?: { nestedContextId?: number };
  };
  resolve: (snap: ClientStateSnapshot | null) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

export class WsLabConnection {
  readonly id: string;
  /** Binding token for `/w7s/virtual-*` (virtual-assets §1.1) — same reserved query name as Live. */
  readonly sessionToken: string;
  private client: WebSocket | null;
  private readonly opts: WsLabOptions;
  private chassis: LabChassis;
  private closed = false;
  private runInFlight = false;
  private debugProbeTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotQueue: SnapshotRequest[] = [];
  private snapshotInFlight: SnapshotRequest | null = null;
  private pendingTamper: {
    resolve: (result: { ok: boolean; reason?: string } | null) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private pendingInject: {
    resolve: (result: import('../runner/execute').InjectAck | null) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  /** CDP endpoint for the browser tab running client.html (Projected surface). */
  private projectedCdpUrl: string | null = null;

  constructor(client: WebSocket, opts: WsLabOptions) {
    this.opts = opts;
    this.chassis = new LabChassis({ headless: opts.headless });
    this.id = this.chassis.connectionId;
    this.sessionToken = randomUUID();
    this.client = client;
    this.bindChassisRelays(this.chassis);
    this.send({
      type: 'session.hello',
      sessionId: this.id,
      sessionToken: this.sessionToken,
      protocolVersion: LAB_PROTOCOL_VERSION,
    });
  }

  async getAsset(
    key: string,
    opts?: { kind?: string; rangeHeader?: string },
  ): Promise<{
    body: Uint8Array;
    contentType: string;
    statusCode?: number;
    contentRange?: string;
    passThrough?: boolean;
  } | null> {
    const session = this.chassis.browser as {
      getAsset?(
        k: string,
        o?: { kind?: string; rangeHeader?: string },
      ): Promise<{
        body: Uint8Array;
        contentType: string;
        statusCode?: number;
        contentRange?: string;
        passThrough?: boolean;
      } | null>;
    } | null;
    if (!session?.getAsset) return null;
    return session.getAsset(key, opts);
  }

  private bindChassisRelays(chassis: LabChassis): void {
    chassis.setFrameRelay((buf) => {
      const c = this.client;
      if (c !== null && c.readyState === c.OPEN) c.send(buf, { binary: true });
    });
    chassis.setTelemetryRelay((message) => this.send({ type: 'telemetry', message }));
    chassis.setConsoleRelay((ev) => {
      this.send({ type: 'console', level: ev.level, text: ev.text, t: ev.t });
    });
    chassis.setFaultRelay((fault) => {
      this.send({
        type: 'session.fault',
        sessionId: chassis.sessionId ?? this.id,
        message: fault.message,
        errorCode: fault.errorCode,
        phase: fault.phase,
        dossierDir: chassis.dossierHandle?.dir,
      });
      // Persist full browse probes on crash without requiring Stop.
      if (fault.source !== 'process') {
        this.stopDebugProbe();
        void (async () => {
          const sid = chassis.sessionId ?? this.id;
          const dossierDir =
            (await chassis.exportDossier([], chassis.sessionWallMs())) ?? undefined;
          await chassis.disposeVirtual();
          this.send({
            type: 'session.stopped',
            sessionId: sid,
            reason: `crash:${fault.errorCode}`,
            dossierDir,
          });
        })();
      }
    });
    chassis.setDebugRelay((payload) => {
      this.send({ type: 'debug.probe', payload });
    });
    chassis.setClientSnapshotProvider((contextId) => this.requestClientSnapshot(contextId));
  }

  private startDebugProbe(): void {
    this.stopDebugProbe();
    this.debugProbeTimer = setInterval(() => {
      if (this.closed) return;
      this.chassis.pushDebugProbe();
    }, 2000);
  }

  private stopDebugProbe(): void {
    if (this.debugProbeTimer) {
      clearInterval(this.debugProbeTimer);
      this.debugProbeTimer = null;
    }
  }

  private send(msg: LabHostMessage): void {
    const c = this.client;
    if (c === null || c.readyState !== c.OPEN) return;
    c.send(JSON.stringify(msg));
  }

  private resolveUrl(raw: string): string {
    if (/^https?:\/\//i.test(raw)) return raw;
    const path = raw.replace(/^\/+/, '');
    const rel = path.startsWith('fixtures/') ? path : `fixtures/${path}`;
    return `${this.opts.publicOrigin}/${rel}`;
  }

  async requestClientSnapshot(
    contextId: number,
    timeoutMs = 5000,
    options?: {
      includeNestedPeek?: boolean;
      registryProbeNodeIds?: number[];
      rectLadderProbe?: { nestedContextId: number; widgetNodeId?: number };
      paintProbe?: {
        nestedContextId: number;
        widgetNodeId?: number;
      };
      cssomSheetDump?: { nestedContextId?: number };
    },
  ): Promise<ClientStateSnapshot | null> {
    if (this.client === null || this.client.readyState !== this.client.OPEN) return null;
    return new Promise<ClientStateSnapshot | null>((resolve) => {
      this.snapshotQueue.push({
        contextId,
        timeoutMs,
        options,
        resolve,
        timer: null,
      });
      this.pumpSnapshotQueue();
    });
  }

  private pumpSnapshotQueue(): void {
    if (this.snapshotInFlight !== null || this.snapshotQueue.length === 0) return;
    if (this.client === null || this.client.readyState !== this.client.OPEN) {
      this.flushSnapshotQueue(null);
      return;
    }
    const req = this.snapshotQueue.shift()!;
    req.timer = setTimeout(() => {
      if (this.snapshotInFlight === req) {
        this.snapshotInFlight = null;
        req.resolve(null);
        this.pumpSnapshotQueue();
      }
    }, req.timeoutMs);
    this.snapshotInFlight = req;
    this.send({
      type: 'requestSnapshot',
      contextId: req.contextId,
      includeNestedPeek: req.options?.includeNestedPeek === true,
      registryProbeNodeIds: req.options?.registryProbeNodeIds,
      rectLadderProbe: req.options?.rectLadderProbe,
      paintProbe: req.options?.paintProbe,
      cssomSheetDump: req.options?.cssomSheetDump,
    });
  }

  private flushSnapshotQueue(result: ClientStateSnapshot | null): void {
    if (this.snapshotInFlight) {
      if (this.snapshotInFlight.timer) clearTimeout(this.snapshotInFlight.timer);
      this.snapshotInFlight.resolve(result);
      this.snapshotInFlight = null;
    }
    for (const req of this.snapshotQueue) {
      if (req.timer) clearTimeout(req.timer);
      req.resolve(result);
    }
    this.snapshotQueue.length = 0;
  }

  private parseClientSnapshotResult(msg: {
    contextId?: number;
    tree?: unknown;
    table?: unknown;
    sequence?: number | null;
    generation?: number | null;
    desynced?: boolean;
    applyError?: string | null;
    armed?: boolean;
    resyncInFlight?: boolean;
    cascade?: unknown;
    formProps?: unknown;
    nestedPeek?: unknown;
    registryProbe?: unknown;
    rectLadder?: unknown;
    paintProbe?: unknown;
    cssomSheetDump?: unknown;
  }): ClientStateSnapshot {
    const tableRaw = msg.table;
    const table =
      typeof tableRaw === 'object' &&
      tableRaw !== null &&
      typeof (tableRaw as { rowCount?: unknown }).rowCount === 'number' &&
      typeof (tableRaw as { tableHash?: unknown }).tableHash === 'string'
        ? (tableRaw as ReplicatedTableDigest)
        : null;
    return {
      contextId: typeof msg.contextId === 'number' ? msg.contextId : 1,
      tree: (msg.tree as TreeNode) ?? null,
      table,
      sequence: msg.sequence ?? null,
      generation: typeof msg.generation === 'number' ? msg.generation : null,
      desynced: msg.desynced === true,
      applyError: typeof msg.applyError === 'string' ? msg.applyError : null,
      armed: msg.armed === true,
      resyncInFlight: msg.resyncInFlight === true,
      cascade:
        typeof msg.cascade === 'object' && msg.cascade !== null
          ? (msg.cascade as ClientStateSnapshot['cascade'])
          : null,
      formProps: Array.isArray(msg.formProps)
        ? (msg.formProps as ClientStateSnapshot['formProps'])
        : null,
      nestedPeek:
        typeof msg.nestedPeek === 'object' && msg.nestedPeek !== null
          ? (msg.nestedPeek as ClientStateSnapshot['nestedPeek'])
          : null,
      registryProbe:
        typeof msg.registryProbe === 'object' && msg.registryProbe !== null
          ? (msg.registryProbe as ClientStateSnapshot['registryProbe'])
          : null,
      rectLadder:
        typeof msg.rectLadder === 'object' && msg.rectLadder !== null
          ? (msg.rectLadder as ClientStateSnapshot['rectLadder'])
          : null,
      paintProbe:
        typeof msg.paintProbe === 'object' && msg.paintProbe !== null
          ? (msg.paintProbe as ClientStateSnapshot['paintProbe'])
          : undefined,
      cssomSheetDump:
        typeof msg.cssomSheetDump === 'object' && msg.cssomSheetDump !== null
          ? (msg.cssomSheetDump as ClientStateSnapshot['cssomSheetDump'])
          : undefined,
    };
  }

  async requestTamper(timeoutMs = 2000): Promise<{ ok: boolean; reason?: string } | null> {
    if (this.client === null || this.client.readyState !== this.client.OPEN) return null;
    if (this.pendingTamper !== null) return null;
    return new Promise<{ ok: boolean; reason?: string } | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTamper = null;
        resolve(null);
      }, timeoutMs);
      this.pendingTamper = { resolve, timer };
      this.send({ type: 'lab.tamper', kind: 'ghostRule' });
    });
  }

  async injectClientFrame(bytes: Uint8Array, timeoutMs = 2000): Promise<import('../runner/execute').InjectAck | null> {
    if (this.client === null || this.client.readyState !== this.client.OPEN) return null;
    if (this.pendingInject !== null) return null;
    return new Promise<import('../runner/execute').InjectAck | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingInject = null;
        resolve(null);
      }, timeoutMs);
      this.pendingInject = { resolve, timer };
      this.send({ type: 'lab.injectFrame', bytes: Buffer.from(bytes).toString('base64') });
    });
  }

  async handleClientMessage(raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean): Promise<void> {
    if (isBinary || this.closed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      this.send({ type: 'error', message: 'invalid JSON control message', code: 'invalid_json' });
      return;
    }
    const msg = parseClientMessage(parsed);
    if ('error' in msg) {
      this.send({ type: 'error', message: msg.error, code: msg.code });
      return;
    }

    switch (msg.type) {
      case 'hello':
        if (msg.protocolVersion !== undefined && msg.protocolVersion !== LAB_PROTOCOL_VERSION) {
          this.send({ type: 'error', message: 'protocol version mismatch', code: 'protocol_mismatch' });
        }
        return;
      case 'browse.start': {
        if (typeof msg.url !== 'string' || !msg.url.trim()) {
          this.send({ type: 'error', message: 'browse.start.url required', code: 'bad_request' });
          return;
        }
        try {
          await this.chassis.disposeVirtual();
          const record = await this.chassis.boot({
            mode: 'browse',
            url: this.resolveUrl(msg.url.trim()),
            frameRateHz: msg.frameRateHz,
            telemetry: msg.telemetry ?? LAB_TELEMETRY_DEFAULTS,
            cpuProfiling: msg.cpuProfiling === true,
            width: typeof msg.width === 'number' ? msg.width : undefined,
            height: typeof msg.height === 'number' ? msg.height : undefined,
            device: msg.device,
          });
          this.startDebugProbe();
          this.send({
            type: 'session.booted',
            sessionId: record.sessionId,
            mode: 'browse',
            url: record.url ?? msg.url,
            dossierDir: record.dossierDir,
          });
        } catch (err) {
          this.stopDebugProbe();
          this.send({
            type: 'session.fault',
            sessionId: this.chassis.sessionId ?? this.id,
            message: err instanceof Error ? err.message : String(err),
            errorCode: 'browse_boot_failed',
            phase: 'boot',
            dossierDir: this.chassis.dossierHandle?.dir,
          });
        }
        return;
      }
      case 'browse.navigate': {
        if (typeof msg.url !== 'string' || !msg.url.trim()) {
          this.send({ type: 'error', message: 'browse.navigate.url required', code: 'bad_request' });
          return;
        }
        try {
          await this.chassis.navigate(this.resolveUrl(msg.url.trim()));
        } catch (err) {
          this.send({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
            code: 'navigate_failed',
          });
        }
        return;
      }
      case 'browse.stop': {
        const sid = this.chassis.sessionId ?? this.id;
        let dossierDir: string | undefined;
        this.stopDebugProbe();
        const wallMs = this.chassis.sessionWallMs();
        if (msg.inputCapture != null) {
          this.chassis.setInputCaptureMetrics(msg.inputCapture);
        }
        // Close Virtual first so a hung browse snap / CDP evaluate cannot block Stop.
        // Stored snaps validate from journal (no live dump). Export writes files after close.
        if (msg.exportDossier && this.chassis.browseSnapCount > 0) {
          try {
            const validated = await this.chassis.validateBrowseSnaps();
            this.send({
              type: 'validate.result',
              allPass: validated.allPass,
              snapCount: validated.snapCount,
              pass: validated.pass,
              fail: validated.fail,
              skipped: validated.skipped,
            });
          } catch (err) {
            this.send({
              type: 'error',
              message: err instanceof Error ? err.message : String(err),
              code: 'validate_failed',
            });
          }
        }
        await this.chassis.disposeVirtual();
        if (msg.exportDossier) {
          dossierDir = (await this.chassis.exportDossier([], wallMs)) ?? undefined;
        }
        this.send({ type: 'session.stopped', sessionId: sid, reason: 'browse.stop', dossierDir });
        return;
      }
      case 'surface.clear':
        // Client clears locally; ack not required
        return;
      case 'run.start': {
        if (this.runInFlight) {
          this.send({ type: 'error', message: 'a run is already in flight', code: 'run_busy' });
          return;
        }
        this.runInFlight = true;
        try {
          const priorSessionId = this.chassis.sessionId ?? this.id;
          await this.chassis.disposeVirtual();
          this.send({
            type: 'session.stopped',
            sessionId: priorSessionId,
            reason: 'runColdBoot',
          });
          // fresh chassis for cold run
          this.stopDebugProbe();
          this.chassis = new LabChassis({ headless: this.opts.headless });
          this.bindChassisRelays(this.chassis);
          const bp = loadBlueprint(msg.blueprintId);
          const overrides = (msg.overrides ?? {}) as {
            url?: string;
            durationMs?: number;
            frameRateHz?: number;
            telemetry?: Record<string, unknown>;
            cpu?: boolean;
            iso?: boolean;
            invariants?: boolean;
            outDir?: string;
            projectedCdpUrl?: string;
          };
          const projectedCdp =
            typeof overrides.projectedCdpUrl === 'string' && overrides.projectedCdpUrl.trim()
              ? overrides.projectedCdpUrl.trim()
              : typeof process.env.SPECULUM_LAB_PROJECTED_CDP_URL === 'string' &&
                  process.env.SPECULUM_LAB_PROJECTED_CDP_URL.trim()
                ? process.env.SPECULUM_LAB_PROJECTED_CDP_URL.trim()
                : null;
          this.projectedCdpUrl = projectedCdp;
          const result = await executeBlueprint(bp, {
            chassis: this.chassis,
            resolveUrl: (u) => this.resolveUrl(u),
            projectedCdpUrl: this.projectedCdpUrl,
            labOrigin: this.opts.publicOrigin,
            requestClientSnapshot: (contextId, options) =>
              this.requestClientSnapshot(contextId, 5000, options),
            requestTamper: () => this.requestTamper(),
            injectClientFrame: (bytes) => this.injectClientFrame(bytes),
            captureProjectedViewportClip: projectedCdp
              ? (clip) => captureProjectedViewportClip(projectedCdp, clip, this.opts.publicOrigin)
              : undefined,
            overrides,
            onProgress: (p) => {
              this.send({
                type: 'run.progress',
                sessionId: this.chassis.sessionId ?? this.id,
                actionId: p.actionId,
                queue: p.queue,
                status: p.status,
                detail: p.detail,
              });
            },
          });
          const summary = {
            pass: result.verdicts.filter((v) => v.status === 'pass').length,
            fail: result.verdicts.filter((v) => v.status === 'fail').length,
            skipped: result.verdicts.filter((v) => v.status === 'skipped').length,
          };
          this.send({
            type: 'run.complete',
            sessionId: this.chassis.sessionId ?? this.id,
            dossierDir: result.dossierDir ?? '',
            verdictsSummary: summary,
          });
          await this.chassis.disposeVirtual();
          this.send({
            type: 'session.stopped',
            sessionId: this.chassis.sessionId ?? this.id,
            reason: 'runComplete',
            dossierDir: result.dossierDir ?? undefined,
          });
        } catch (err) {
          this.send({
            type: 'session.fault',
            sessionId: this.chassis.sessionId ?? this.id,
            message: err instanceof Error ? err.message : String(err),
          });
        } finally {
          this.runInFlight = false;
        }
        return;
      }
      case 'run.abort':
        this.send({ type: 'error', message: 'run.abort not implemented', code: 'not_implemented' });
        return;
      case 'client.telemetry': {
        const m = acceptClientTelemetry(msg.message);
        if (m) this.chassis.observeTelemetry(m);
        return;
      }
      case 'client.requestResync': {
        void this.chassis.browser?.requestResync?.({
          reason: typeof msg.reason === 'string' ? msg.reason : 'client',
          contextId: typeof msg.contextId === 'number' && msg.contextId > 0 ? msg.contextId : 1,
        });
        return;
      }
      case 'client.intent': {
        const session = this.chassis.browser;
        const push = (session as {
          pushInput?: (i: unknown) => Promise<{ status: string; reason?: string } | unknown>;
          getInputPipelineMetrics?: () => {
            lastOutcome?: {
              mode?: 'A' | 'B' | 'C' | 'OS' | 'CDP';
              dispatchMs?: number;
              clientLagMs?: number;
            } | null;
          };
          getInputBackend?: () => 'os' | 'cdp';
        } | null);
        const pushFn = push?.pushInput?.bind(session);
        if (!pushFn) {
          this.send({ type: 'error', message: 'pushInput unavailable', code: 'input_unavailable' });
          return;
        }
        const intentRaw = msg.intent;
        if (!intentRaw || typeof intentRaw !== 'object') {
          this.send({ type: 'error', message: 'client.intent missing intent', code: 'invalid_intent' });
          return;
        }
        const intent = intentRaw as Record<string, unknown>;
        const timingOf = () => {
          const last = push?.getInputPipelineMetrics?.()?.lastOutcome;
          const backend = push?.getInputBackend?.();
          return {
            mode: last?.mode ?? (backend === 'cdp' ? 'CDP' : 'OS'),
            dispatchMs: last?.dispatchMs,
            clientLagMs: last?.clientLagMs,
          };
        };
        try {
          const out = await pushFn(intent);
          const timing = timingOf();
          if (
            out
            && typeof out === 'object'
            && (out as { status?: string }).status === 'dropped'
          ) {
            const reason = (out as { reason?: string }).reason ?? 'dropped';
            await this.chassis.journalIntent(intent, { ok: false, error: reason, ...timing });
            this.send({
              type: 'error',
              message: `intent dropped: ${reason}`,
              code: 'input_dropped',
            });
            return;
          }
          await this.chassis.journalIntent(intent, { ok: true, ...timing });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          await this.chassis.journalIntent(intent, { ok: false, error: message, ...timingOf() });
          this.send({
            type: 'error',
            message,
            code: 'input_dispatch_failed',
          });
        }
        return;
      }
      case 'client.snapshot': {
        try {
          const record = await this.chassis.captureBrowseSnap(
            typeof msg.label === 'string' ? msg.label : undefined,
          );
          this.send({
            type: 'snap.stored',
            id: record.id,
            sequence: (record.iso as { sequence?: number | null } | null)?.sequence ?? null,
            generation: (record.iso as { generation?: number | null } | null)?.generation ?? null,
            allPass: record.allPass,
            label: record.label,
            snapCount: this.chassis.browseSnapCount,
          });
        } catch (err) {
          this.send({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
            code: 'snapshot_failed',
          });
        }
        return;
      }
      case 'client.validateSnaps': {
        try {
          const validated = await this.chassis.validateBrowseSnaps();
          this.send({
            type: 'validate.result',
            allPass: validated.allPass,
            snapCount: validated.snapCount,
            pass: validated.pass,
            fail: validated.fail,
            skipped: validated.skipped,
            dossierPath: this.chassis.dossierHandle?.dir,
          });
        } catch (err) {
          this.send({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
            code: 'validate_failed',
          });
        }
        return;
      }
      case 'client.snapshotResult': {
        const inflight = this.snapshotInFlight;
        if (inflight === null) return;
        const contextId = typeof msg.contextId === 'number' ? msg.contextId : 1;
        if (contextId !== inflight.contextId) return;
        if (inflight.timer) clearTimeout(inflight.timer);
        this.snapshotInFlight = null;
        inflight.resolve(this.parseClientSnapshotResult(msg));
        this.pumpSnapshotQueue();
        return;
      }
      case 'client.tamperResult': {
        const pending = this.pendingTamper;
        if (pending !== null) {
          this.pendingTamper = null;
          clearTimeout(pending.timer);
          pending.resolve({
            ok: msg.ok === true,
            reason: typeof msg.reason === 'string' ? msg.reason : undefined,
          });
        }
        return;
      }
      case 'client.injectResult': {
        const pending = this.pendingInject;
        if (pending !== null) {
          this.pendingInject = null;
          clearTimeout(pending.timer);
          pending.resolve({
            sequence: typeof msg.sequence === 'number' ? msg.sequence : null,
            generation: typeof msg.generation === 'number' ? msg.generation : null,
            desynced: msg.desynced === true,
            applyError: typeof msg.applyError === 'string' ? msg.applyError : null,
            tableHash: typeof msg.tableHash === 'string' ? msg.tableHash : null,
          });
        }
        return;
      }
      case 'client.resize': {
        if (typeof msg.width !== 'number' || typeof msg.height !== 'number') {
          this.send({
            type: 'session.resized',
            applied: false,
            width: 0,
            height: 0,
            errorCode: 'bad_request',
            message: 'client.resize width/height required',
          });
          return;
        }
        try {
          const result = await this.chassis.resize({
            width: msg.width,
            height: msg.height,
            device: msg.device,
          });
          this.send({
            type: 'session.resized',
            applied: result.ok,
            width: result.width,
            height: result.height,
            errorCode: result.errorCode,
            message: result.message,
          });
        } catch (err) {
          this.send({
            type: 'session.resized',
            applied: false,
            width: msg.width,
            height: msg.height,
            errorCode: 'resize_failed',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      default:
        this.send({ type: 'error', message: 'unhandled type', code: 'unknown_type' });
    }
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopDebugProbe();
    this.flushSnapshotQueue(null);
    if (this.pendingTamper) {
      clearTimeout(this.pendingTamper.timer);
      this.pendingTamper.resolve(null);
      this.pendingTamper = null;
    }
    if (this.pendingInject) {
      clearTimeout(this.pendingInject.timer);
      this.pendingInject.resolve(null);
      this.pendingInject = null;
    }
    await this.chassis.dispose();
    this.client = null;
  }
}

export { listBlueprintIds as listLabBlueprints, listBlueprintSummaries as listLabBlueprintSummaries } from '../runner/loadBlueprint';

export function labFixturesManifestPath(): string {
  const { fixturesDir } = labAssetRoots();
  return `${fixturesDir.replace(/\\/g, '/')}/manifest.json`;
}

export { reportExitCode };
