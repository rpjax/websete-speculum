/**
 * Composition root — Patchright BrowserSession by default; mock when SPECULUM_BROWSER=mock.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as grpc from '@grpc/grpc-js';
import { createMockBrowserSessionFactory } from './browser/MockBrowserSession';
import { createPatchrightFactory } from './browser/patchright/createPatchrightFactory';
import type { BrowserSessionFactory } from './browser/BrowserSession';
import { SessionRegistry } from './host/SessionRegistry';
import { getBrowserSessionService } from './grpc/loadProto';
import { createBrowserSessionHandlers } from './grpc/BrowserSessionService';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`${name} environment variable is required`);
  }
  return value.trim();
}

function resolveBrowserMode(): 'mock' | 'patchright' {
  const mode = requireEnv('SPECULUM_BROWSER');
  if (mode !== 'mock' && mode !== 'patchright') {
    throw new Error('SPECULUM_BROWSER must be "mock" or "patchright"');
  }
  return mode;
}

export function resolveBrowserFactory(options: {
  emitFrames: boolean;
  frameIntervalMs: number;
}): BrowserSessionFactory {
  if (resolveBrowserMode() === 'mock') {
    return createMockBrowserSessionFactory({
      emitFrames: options.emitFrames,
      frameIntervalMs: options.frameIntervalMs,
    });
  }
  requireEnv('CHROME_EXECUTABLE');
  return createPatchrightFactory();
}

export function createSidecarServer(options: {
  emitFrames: boolean;
  frameIntervalMs: number;
  factory: BrowserSessionFactory;
}): { server: grpc.Server; registry: SessionRegistry } {
  const registry = new SessionRegistry(options.factory);
  const server = new grpc.Server();
  server.addService(getBrowserSessionService(), createBrowserSessionHandlers(registry));
  return { server, registry };
}

export function bindAndStart(
  server: grpc.Server,
  bindAddress: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    server.bindAsync(bindAddress, grpc.ServerCredentials.createInsecure(), (err, port) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(`0.0.0.0:${port}`);
    });
  });
}

function chromePresent(): boolean {
  if (resolveBrowserMode() === 'mock') return true;
  try {
    return fs.existsSync(requireEnv('CHROME_EXECUTABLE'));
  } catch {
    return false;
  }
}

export function startHealthServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url === '/ready') {
      const ready = chromePresent();
      const chromeExecutable = process.env['CHROME_EXECUTABLE'] ?? '';
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: ready ? 'ready' : 'not_ready',
          chrome: chromeExecutable,
          chromePresent: ready,
          browser: process.env['SPECULUM_BROWSER'] ?? '',
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`[sidecar-refactor] health HTTP on 0.0.0.0:${port}`);
  });
  return server;
}

function tryShutdownGrpc(server: grpc.Server, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      server.forceShutdown();
      resolve();
    }, timeoutMs);
    server.tryShutdown((err) => {
      clearTimeout(timer);
      if (err) server.forceShutdown();
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const mode = resolveBrowserMode();
  const grpcPort = requireEnv('SPECULUM_GRPC_PORT');
  const healthPort = Number(requireEnv('SPECULUM_HEALTH_PORT'));
  const factory = resolveBrowserFactory({ emitFrames: true, frameIntervalMs: 500 });
  const { server, registry } = createSidecarServer({
    emitFrames: true,
    frameIntervalMs: 500,
    factory,
  });
  const health = startHealthServer(healthPort);
  const addr = await bindAndStart(server, `0.0.0.0:${grpcPort}`);
  console.log(`[sidecar-refactor] BrowserSessionService (${mode}) listening on ${addr}`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[sidecar-refactor] ${signal} — graceful shutdown`);
    await new Promise<void>((resolve) => health.close(() => resolve()));
    await registry.disposeAll();
    await tryShutdownGrpc(server, 10_000);
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
