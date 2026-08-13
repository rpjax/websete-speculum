/**
 * One lab session: client control WS + Virtual Chromium + Virtual data-plane WS.
 * Relays Frame bytes + Telemetry (JSON) Virtual → Client. No .NET / gRPC.
 */

import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { PlaneChannel } from '../plane';
import {
  LAB_TELEMETRY_DEFAULTS,
  isProjectionTelemetryMessage,
  type ProjectionTelemetryMessage,
} from '../models/telemetry';
import { NodeDataPlane } from './nodeDataPlane';
import type { ProjectionTelemetrySink } from './projectionTelemetrySink';
import { launchVirtualBrowser, type VirtualBrowserHandle } from './virtualBrowser';

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
    this.sendJson({ type: 'error', message: `unknown control type: ${String(type)}` });
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.stopBrowser();
    this.virtualData.close();
    this.client = null;
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
    if (header !== null) {
      this.stats.lastGeneration = header.generation;
      this.stats.lastSequence = header.sequence;
    }
    const client = this.client;
    if (client !== null && client.readyState === client.OPEN) {
      client.send(buf, { binary: true });
    }
    if (this.stats.framesFromVirtual === 1 || this.stats.framesFromVirtual % 15 === 0) {
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
