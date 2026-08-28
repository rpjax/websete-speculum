/**
 * In-process WebSocket data plane for V4 PageProjection BrowserSession.
 * Chromium LoopbackFrameTransport connects here; lab/UI never attach this socket themselves.
 */

import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { NodeDataPlane } from './nodeDataPlane';
import { PlaneChannel } from '@speculum/page-projection/core/plane';

export class ProjectionDataPlaneHost {
  readonly dataPlane = new NodeDataPlane();
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private url = '';

  get listenUrl(): string {
    return this.url;
  }

  configureSession(sessionId: string, generation: number): void {
    this.dataPlane.setExpectedSession({ sessionId, generation });
  }

  waitEstablished(opts: { generation: number; timeoutMs?: number }): Promise<void> {
    return this.dataPlane.waitEstablished(opts);
  }

  get isEstablished(): boolean {
    return this.dataPlane.isEstablished;
  }

  async listen(): Promise<string> {
    if (this.url) return this.url;
    const httpServer = http.createServer((_req, res) => {
      res.writeHead(404).end();
    });
    this.httpServer = httpServer;
    const wss = new WebSocketServer({ noServer: true });
    this.wss = wss;

    httpServer.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        this.dataPlane.attach(ws);
      });
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
      httpServer.on('error', reject);
    });
    const addr = httpServer.address();
    if (!addr || typeof addr === 'string') throw new Error('ProjectionDataPlaneHost: no listen address');
    this.url = `ws://127.0.0.1:${addr.port}/`;
    return this.url;
  }

  sendControl(message: Record<string, unknown>): void {
    this.dataPlane.send(PlaneChannel.Control, new TextEncoder().encode(JSON.stringify(message)));
  }

  /** Sidecar → Virtual RPC on the loopback mux (§10.1c). */
  invoke(name: string, args?: unknown, opts?: { timeoutMs?: number }) {
    return this.dataPlane.invoke(name, args, opts);
  }

  async close(): Promise<void> {
    this.dataPlane.close();
    const wss = this.wss;
    this.wss = null;
    if (wss) await new Promise<void>((resolve) => wss.close(() => resolve()));
    const httpServer = this.httpServer;
    this.httpServer = null;
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
    this.url = '';
  }
}
