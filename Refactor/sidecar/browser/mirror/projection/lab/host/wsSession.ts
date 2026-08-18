/**
 * Lab WS connection — Browse + Run over protocol v1.
 */

import type { WebSocket } from 'ws';
import type { TreeNode } from '../../models/treeNode';
import type { ReplicatedTableDigest } from '../../models/tableDigest';
import { LAB_TELEMETRY_DEFAULTS } from '../../models/telemetry';
import { LabChassis, acceptClientTelemetry, type ClientStateSnapshot } from './chassis';
import { LAB_PROTOCOL_VERSION, parseClientMessage, type LabHostMessage } from './protocol';
import { loadBlueprint } from '../runner/loadBlueprint';
import { executeBlueprint } from '../runner/execute';
import { labAssetRoots } from '../assetRoots';
import { reportExitCode } from '../dossier/types';

export type WsLabOptions = {
  headless: boolean;
  publicOrigin: string;
};

export class WsLabConnection {
  readonly id: string;
  private client: WebSocket | null;
  private readonly opts: WsLabOptions;
  private chassis: LabChassis;
  private closed = false;
  private runInFlight = false;
  private pendingSnapshot: {
    resolve: (snap: ClientStateSnapshot | null) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private pendingTamper: {
    resolve: (result: { ok: boolean; reason?: string } | null) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private pendingInject: {
    resolve: (result: import('../runner/execute').InjectAck | null) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(client: WebSocket, opts: WsLabOptions) {
    this.opts = opts;
    this.chassis = new LabChassis({ headless: opts.headless });
    this.id = this.chassis.connectionId;
    this.client = client;
    this.chassis.setFrameRelay((buf) => {
      const c = this.client;
      if (c !== null && c.readyState === c.OPEN) c.send(buf, { binary: true });
    });
    this.chassis.setTelemetryRelay((message) => {
      this.send({ type: 'telemetry', message });
    });
    this.send({ type: 'session.hello', sessionId: this.id, protocolVersion: LAB_PROTOCOL_VERSION });
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

  async requestClientSnapshot(timeoutMs = 5000): Promise<ClientStateSnapshot | null> {
    if (this.client === null || this.client.readyState !== this.client.OPEN) return null;
    if (this.pendingSnapshot !== null) return null;
    return new Promise<ClientStateSnapshot | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingSnapshot = null;
        resolve(null);
      }, timeoutMs);
      this.pendingSnapshot = { resolve, timer };
      this.send({ type: 'requestSnapshot' });
    });
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
            cpuProfiling: false,
          });
          this.send({
            type: 'session.booted',
            sessionId: record.sessionId,
            mode: 'browse',
            url: record.url ?? msg.url,
            dossierDir: record.dossierDir,
          });
        } catch (err) {
          this.send({
            type: 'session.fault',
            sessionId: this.chassis.sessionId ?? this.id,
            message: err instanceof Error ? err.message : String(err),
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
        if (msg.exportDossier) {
          dossierDir = (await this.chassis.exportDossier([], 0)) ?? undefined;
        }
        await this.chassis.disposeVirtual();
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
          this.chassis = new LabChassis({ headless: this.opts.headless });
          this.chassis.setFrameRelay((buf) => {
            const c = this.client;
            if (c !== null && c.readyState === c.OPEN) c.send(buf, { binary: true });
          });
          this.chassis.setTelemetryRelay((message) => this.send({ type: 'telemetry', message }));

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
          };
          const result = await executeBlueprint(bp, {
            chassis: this.chassis,
            resolveUrl: (u) => this.resolveUrl(u),
            requestClientSnapshot: () => this.requestClientSnapshot(),
            requestTamper: () => this.requestTamper(),
            injectClientFrame: (bytes) => this.injectClientFrame(bytes),
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
        this.chassis.browser?.sendPageProjectionControl?.({
          type: 'requestResync',
          reason: msg.reason ?? 'client',
        });
        return;
      }
      case 'client.snapshotResult': {
        const pending = this.pendingSnapshot;
        if (pending !== null) {
          this.pendingSnapshot = null;
          clearTimeout(pending.timer);
          const tableRaw = msg.table;
          const table =
            typeof tableRaw === 'object' &&
            tableRaw !== null &&
            typeof (tableRaw as { rowCount?: unknown }).rowCount === 'number' &&
            typeof (tableRaw as { tableHash?: unknown }).tableHash === 'string'
              ? (tableRaw as ReplicatedTableDigest)
              : null;
          pending.resolve({
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
          });
        }
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
      default:
        this.send({ type: 'error', message: 'unhandled type', code: 'unknown_type' });
    }
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.pendingSnapshot) {
      clearTimeout(this.pendingSnapshot.timer);
      this.pendingSnapshot.resolve(null);
      this.pendingSnapshot = null;
    }
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
