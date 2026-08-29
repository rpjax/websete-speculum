/**
 * Extension C2 — sidecar ↔ Speculum PP service worker (SessionConfig + ACK).
 * runtime-redesign.md §0 #3 / §4: fail-closed; navigate only after ACK.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

export const EXTENSION_C2_CHANNEL = 'speculum.extension.c2' as const;

export type ExtensionSessionConfig = {
  sessionId: string;
  dataPlaneUrl: string;
  planeBridgeToken: string;
  transport?: 'loopback' | 'console' | 'discard';
  loopbackCarrier?: 'extension';
  frameRateHz?: number;
  bufferedAmountWatermark?: number;
  maxFrameBytes?: number;
  telemetry?: Record<string, unknown>;
  cssomPollHz?: number;
};

type C2Message = {
  channel?: string;
  kind?: string;
  config?: ExtensionSessionConfig;
  ok?: boolean;
  sessionId?: string | null;
  reason?: string;
  extensionId?: string;
  generation?: number;
  url?: string;
  installKind?: string;
  t?: string;
};

export type DocumentInstallEvent = {
  generation: number;
  url: string;
  installKind: 'blank' | 'navigation';
  t: string;
  installedAtMs: number;
};

export type ExtensionC2HostOptions = {
  /**
   * Per-session unpacked `speculum-pp` directory (receives `c2-endpoint.json`).
   * May be set later via {@link setExtensionDir} before {@link listen}.
   */
  extensionDir?: string;
  ackTimeoutMs?: number;
};

export class ExtensionC2Host {
  private extensionDir: string;
  private readonly ackTimeoutMs: number;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private listenUrl: string | null = null;
  private pendingAck: {
    sessionId: string;
    resolve: (ok: boolean) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private connectWaiters: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private documentInstallHandler: ((evt: DocumentInstallEvent) => void) | null = null;
  private readonly installEvents: DocumentInstallEvent[] = [];

  constructor(opts: ExtensionC2HostOptions = {}) {
    this.extensionDir = opts.extensionDir ?? '';
    this.ackTimeoutMs = opts.ackTimeoutMs ?? 5_000;
  }

  /** Bind the per-session extension directory before {@link listen}. */
  setExtensionDir(dir: string): void {
    if (this.listenUrl) {
      throw new Error('ExtensionC2Host: cannot change extensionDir while listening');
    }
    if (!dir.trim()) throw new Error('ExtensionC2Host: extensionDir required');
    this.extensionDir = dir.trim();
  }

  get url(): string {
    if (!this.listenUrl) throw new Error('ExtensionC2Host not listening');
    return this.listenUrl;
  }

  get isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === 1;
  }

  /** Start WS listener and write `c2-endpoint.json` for the SW (must run before loadUnpacked). */
  async listen(): Promise<string> {
    if (this.listenUrl) return this.listenUrl;
    if (!this.extensionDir.trim()) {
      throw new Error('ExtensionC2Host: extensionDir required before listen');
    }

    const server = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('ExtensionC2Host: failed to bind');
    }
    this.listenUrl = `ws://127.0.0.1:${addr.port}/speculum-c2`;

    this.wss = new WebSocketServer({ server, path: '/speculum-c2' });
    this.wss.on('connection', (ws) => {
      if (this.socket && this.socket !== ws) {
        try {
          this.socket.close(1000, 'replaced');
        } catch {
          /* ignore */
        }
      }
      this.socket = ws;
      ws.on('message', (data) => this.onMessage(String(data)));
      ws.on('close', () => {
        if (this.socket === ws) this.socket = null;
      });
      this.resolveConnectWaiters();
    });

    this.writeEndpointFile();
    return this.listenUrl;
  }

  /** Block until the extension SW has connected (after loadUnpacked). */
  waitConnected(timeoutMs = 15_000): Promise<void> {
    if (this.isConnected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.connectWaiters = this.connectWaiters.filter((w) => w.timer !== timer);
        reject(
          Object.assign(new Error('extension C2 SW did not connect'), {
            errorCode: 'extension_c2_connect_timeout',
            phase: 'launch',
          }),
        );
      }, timeoutMs);
      this.connectWaiters.push({ resolve, reject, timer });
    });
  }

  private resolveConnectWaiters(): void {
    const waiters = this.connectWaiters;
    this.connectWaiters = [];
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve();
    }
  }

  /** Sidecar hook — `document.install` from SW on each initContext-ok. */
  setDocumentInstallHandler(fn: (evt: DocumentInstallEvent) => void): void {
    this.documentInstallHandler = fn;
  }

  getInstallEvents(): DocumentInstallEvent[] {
    return [...this.installEvents];
  }

  /** Push SessionConfig; resolves true on ACK ok. Throws on timeout / NACK. */
  async pushSessionConfig(config: ExtensionSessionConfig, timeoutMs?: number): Promise<void> {
    if (!this.socket || this.socket.readyState !== 1) {
      throw Object.assign(new Error('extension C2 not connected'), {
        errorCode: 'extension_c2_not_connected',
        phase: 'launch',
      });
    }
    if (this.pendingAck) {
      clearTimeout(this.pendingAck.timer);
      this.pendingAck.reject(new Error('extension C2 ack superseded'));
      this.pendingAck = null;
    }

    const sessionId = config.sessionId;
    const ackMs = timeoutMs ?? this.ackTimeoutMs;
    const ackPromise = new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingAck?.sessionId === sessionId) this.pendingAck = null;
        reject(
          Object.assign(new Error('extension SessionConfig ACK timeout'), {
            errorCode: 'extension_c2_ack_timeout',
            phase: 'launch',
          }),
        );
      }, ackMs);
      this.pendingAck = { sessionId, resolve, reject, timer };
    });

    this.socket.send(
      JSON.stringify({
        channel: EXTENSION_C2_CHANNEL,
        kind: 'SessionConfig',
        config,
      } satisfies C2Message),
    );

    const ok = await ackPromise;
    if (!ok) {
      throw Object.assign(new Error('extension SessionConfig NACK'), {
        errorCode: 'extension_c2_nack',
        phase: 'launch',
      });
    }
  }

  async close(): Promise<void> {
    if (this.pendingAck) {
      clearTimeout(this.pendingAck.timer);
      this.pendingAck.reject(new Error('extension C2 closed'));
      this.pendingAck = null;
    }
    try {
      this.socket?.close();
    } catch {
      /* ignore */
    }
    this.socket = null;
    await new Promise<void>((resolve) => {
      this.wss?.close(() => resolve());
      if (!this.wss) resolve();
    });
    this.wss = null;
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
      if (!this.server) resolve();
    });
    this.server = null;
    this.listenUrl = null;
  }

  private writeEndpointFile(): void {
    if (!this.extensionDir.trim()) {
      throw new Error('ExtensionC2Host: extensionDir required before writeEndpointFile');
    }
    const file = path.join(this.extensionDir, 'c2-endpoint.json');
    fs.writeFileSync(file, `${JSON.stringify({ url: this.listenUrl }, null, 2)}\n`, 'utf8');
  }

  private onMessage(raw: string): void {
    let msg: C2Message;
    try {
      msg = JSON.parse(raw) as C2Message;
    } catch {
      return;
    }
    if (msg.channel !== EXTENSION_C2_CHANNEL) return;
    if (msg.kind === 'SessionConfigAck' && this.pendingAck) {
      clearTimeout(this.pendingAck.timer);
      const pending = this.pendingAck;
      this.pendingAck = null;
      pending.resolve(msg.ok === true);
      return;
    }
    if (msg.kind === 'DocumentInstall') {
      const generation = typeof msg.generation === 'number' ? msg.generation : 0;
      const url = typeof msg.url === 'string' ? msg.url : '';
      const installKind = msg.installKind === 'blank' ? 'blank' : 'navigation';
      const evt: DocumentInstallEvent = {
        generation,
        url,
        installKind,
        t: typeof msg.t === 'string' ? msg.t : new Date().toISOString(),
        installedAtMs: Date.now(),
      };
      this.installEvents.push(evt);
      this.documentInstallHandler?.(evt);
    }
  }
}
