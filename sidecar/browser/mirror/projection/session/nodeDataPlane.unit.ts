import assert from 'assert';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  encodeLoopbackHello,
  encodeLoopbackInvokeResult,
} from '@speculum/page-projection/core';
import { NodeDataPlane } from './nodeDataPlane';

const SESSION = 'unit-loopback-session';
const GENERATION = 1;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withServer(
  run: (url: string, wss: WebSocketServer) => Promise<void>,
): Promise<void> {
  const httpServer = http.createServer((_req, res) => {
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws);
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
    httpServer.on('error', reject);
  });
  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') throw new Error('no listen port');
  const url = `ws://127.0.0.1:${addr.port}/`;
  try {
    await run(url, wss);
  } finally {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function connectClient(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function helloHandshake(
  plane: NodeDataPlane,
  url: string,
  wss: WebSocketServer,
  opts?: { sessionId?: string; generation?: number },
): Promise<WebSocket> {
  const sessionId = opts?.sessionId ?? SESSION;
  const generation = opts?.generation ?? GENERATION;
  plane.setExpectedSession({ sessionId, generation });
  const wsPromise = new Promise<WebSocket>((resolve) => {
    wss.once('connection', (ws) => {
      plane.attach(ws);
      resolve(ws);
    });
  });
  const client = await connectClient(url);
  client.send(Buffer.from(encodeLoopbackHello(sessionId, generation)), { binary: true });
  const serverWs = await wsPromise;
  await wait(20);
  return client;
}

export async function runNodeDataPlaneUnitTests(): Promise<void> {
  await testReplaceClosesPredecessor();
  await testHelloHandshakeEstablished();
  await testGenerationMismatchReject();
  await testNewerGenerationSupersedesEstablished();
  await testSameSocketGenerationSupersedes();
  await testSameSocketIdempotentHello();
  await testStaleCloseDoesNotKillSuccessor();
  await testInvokeOnlyWhenEstablished();
  await testWaitEstablishedSurvivesIntermediateClose();
  console.log('[unit] nodeDataPlane establish protocol ok');
}

async function testReplaceClosesPredecessor(): Promise<void> {
  await withServer(async (url, wss) => {
    const plane = new NodeDataPlane();
    plane.setExpectedSession({ sessionId: SESSION, generation: GENERATION });

    const clientA = await helloHandshake(plane, url, wss);
    assert.strictEqual(plane.isEstablished, true);
    assert.strictEqual(clientA.readyState, WebSocket.OPEN);

    const clientB = await helloHandshake(plane, url, wss);
    await wait(30);
    assert.strictEqual(clientA.readyState, WebSocket.CLOSED, 'predecessor must close on replace');
    assert.strictEqual(clientB.readyState, WebSocket.OPEN);
    assert.strictEqual(plane.isEstablished, true);
    clientB.close();
  });
}

async function testHelloHandshakeEstablished(): Promise<void> {
  await withServer(async (url, wss) => {
    const plane = new NodeDataPlane();
    plane.setExpectedSession({ sessionId: SESSION, generation: GENERATION });
    const client = await helloHandshake(plane, url, wss);
    assert.strictEqual(plane.isEstablished, true);
    assert.strictEqual(plane.status.state, 'established');
    client.close();
  });
}

async function testGenerationMismatchReject(): Promise<void> {
  // Invalid generation (< 1) is still rejected; a different positive generation is adopted
  // (sidecar observes initContext — does not predict).
  await withServer(async (url, wss) => {
    const plane = new NodeDataPlane();
    plane.setExpectedSession({ sessionId: SESSION });
    wss.once('connection', (ws) => plane.attach(ws));
    const bad = await connectClient(url);
    bad.send(Buffer.from(encodeLoopbackHello(SESSION, 0)), { binary: true });
    await wait(50);
    assert.strictEqual(plane.isEstablished, false);
    assert.strictEqual(bad.readyState, WebSocket.CLOSED);

    wss.once('connection', (ws) => plane.attach(ws));
    const good = await connectClient(url);
    good.send(Buffer.from(encodeLoopbackHello(SESSION, GENERATION + 5)), { binary: true });
    await wait(50);
    assert.strictEqual(plane.isEstablished, true);
    assert.strictEqual(plane.status.generation, GENERATION + 5);
    good.close();
  });
}

async function testNewerGenerationSupersedesEstablished(): Promise<void> {
  await withServer(async (url, wss) => {
    const plane = new NodeDataPlane();
    plane.setExpectedSession({ sessionId: SESSION, generation: GENERATION });

    const clientA = await helloHandshake(plane, url, wss);
    assert.strictEqual(plane.isEstablished, true);
    assert.strictEqual(plane.status.generation, GENERATION);

    wss.once('connection', (ws) => plane.attach(ws));
    const clientB = await connectClient(url);
    clientB.send(Buffer.from(encodeLoopbackHello(SESSION, GENERATION + 1)), { binary: true });
    await wait(50);
    assert.strictEqual(plane.isEstablished, true);
    assert.strictEqual(plane.status.generation, GENERATION + 1);
    assert.strictEqual(clientB.readyState, WebSocket.OPEN);
    assert.strictEqual(clientA.readyState, WebSocket.CLOSED, 'predecessor closes on gen supersede');
    clientB.close();
  });
}

async function testSameSocketGenerationSupersedes(): Promise<void> {
  await withServer(async (url, wss) => {
    const plane = new NodeDataPlane();
    plane.setExpectedSession({ sessionId: SESSION, generation: GENERATION });

    wss.once('connection', (ws) => plane.attach(ws));
    const client = await connectClient(url);
    client.send(Buffer.from(encodeLoopbackHello(SESSION, GENERATION)), { binary: true });
    await wait(30);
    assert.strictEqual(plane.isEstablished, true);
    assert.strictEqual(plane.status.generation, GENERATION);

    client.send(Buffer.from(encodeLoopbackHello(SESSION, GENERATION + 1)), { binary: true });
    await wait(30);
    assert.strictEqual(plane.isEstablished, true);
    assert.strictEqual(plane.status.generation, GENERATION + 1);
    assert.strictEqual(client.readyState, WebSocket.OPEN);
    client.close();
  });
}

async function testSameSocketIdempotentHello(): Promise<void> {
  await withServer(async (url, wss) => {
    const plane = new NodeDataPlane();
    plane.setExpectedSession({ sessionId: SESSION, generation: GENERATION });

    wss.once('connection', (ws) => plane.attach(ws));
    const client = await connectClient(url);
    client.send(Buffer.from(encodeLoopbackHello(SESSION, GENERATION)), { binary: true });
    await wait(30);
    assert.strictEqual(plane.isEstablished, true);

    client.send(Buffer.from(encodeLoopbackHello(SESSION, GENERATION)), { binary: true });
    await wait(20);
    assert.strictEqual(plane.isEstablished, true);
    assert.strictEqual(plane.status.generation, GENERATION);
    assert.strictEqual(client.readyState, WebSocket.OPEN);
    client.close();
  });
}

async function testStaleCloseDoesNotKillSuccessor(): Promise<void> {
  await withServer(async (url, wss) => {
    const plane = new NodeDataPlane();
    plane.setExpectedSession({ sessionId: SESSION, generation: GENERATION });

    let serverA: WebSocket | undefined;
    wss.once('connection', (ws) => {
      serverA = ws;
      plane.attach(ws);
    });
    const clientA = await connectClient(url);
    clientA.send(Buffer.from(encodeLoopbackHello(SESSION, GENERATION)), { binary: true });
    await wait(30);
    assert.strictEqual(plane.isEstablished, true);

    wss.once('connection', (ws) => plane.attach(ws));
    const clientB = await connectClient(url);
    clientB.send(Buffer.from(encodeLoopbackHello(SESSION, GENERATION)), { binary: true });
    await wait(30);
    assert.strictEqual(plane.isEstablished, true);
    assert.strictEqual(clientB.readyState, WebSocket.OPEN);

    if (serverA) {
      try {
        serverA.close();
      } catch {
        /* ignore */
      }
    }
    await wait(20);
    assert.strictEqual(plane.isEstablished, true, 'stale close must not clear successor');
    clientB.close();
  });
}

async function testInvokeOnlyWhenEstablished(): Promise<void> {
  await withServer(async (url, wss) => {
    const plane = new NodeDataPlane();
    plane.setExpectedSession({ sessionId: SESSION, generation: GENERATION });

    const notEst = await plane.invoke('applyScrollSet', {});
    assert.strictEqual(notEst.ok, false);
    assert.strictEqual(notEst.error?.name, 'not_established');

    const client = await helloHandshake(plane, url, wss);

    client.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      const env = JSON.parse(buf.toString('utf8')) as { kind?: string; correlationId?: number };
      if (env.kind === 'invoke' && typeof env.correlationId === 'number') {
        client.send(
          Buffer.from(
            encodeLoopbackInvokeResult(env.correlationId, { ok: true, value: { ok: true } }),
          ),
          { binary: true },
        );
      }
    });

    const ok = await plane.invoke('applyScrollSet', { scrollX: 0, scrollY: 1 });
    assert.strictEqual(ok.ok, true);
    client.close();
  });
}

/** Doc churn: first socket dies before hello; waiter must survive until successor establishes. */
async function testWaitEstablishedSurvivesIntermediateClose(): Promise<void> {
  await withServer(async (url, wss) => {
    const plane = new NodeDataPlane();
    plane.setExpectedSession({ sessionId: SESSION, generation: GENERATION });

    const waitPromise = plane.waitEstablished({ generation: GENERATION, timeoutMs: 5_000 });

    wss.once('connection', (ws) => plane.attach(ws));
    const ghost = await connectClient(url);
    await wait(20);
    ghost.close();
    await wait(30);
    assert.strictEqual(plane.isEstablished, false);

    wss.once('connection', (ws) => plane.attach(ws));
    const client = await connectClient(url);
    client.send(Buffer.from(encodeLoopbackHello(SESSION, GENERATION)), { binary: true });
    await waitPromise;
    assert.strictEqual(plane.isEstablished, true);
    client.close();
  });
}
