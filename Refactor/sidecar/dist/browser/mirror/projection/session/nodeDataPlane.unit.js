"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runNodeDataPlaneUnitTests = runNodeDataPlaneUnitTests;
const assert_1 = __importDefault(require("assert"));
const node_http_1 = __importDefault(require("node:http"));
const ws_1 = require("ws");
const core_1 = require("@speculum/page-projection/core");
const nodeDataPlane_1 = require("./nodeDataPlane");
const SESSION = 'unit-loopback-session';
const GENERATION = 1;
function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
async function withServer(run) {
    const httpServer = node_http_1.default.createServer((_req, res) => {
        res.writeHead(404).end();
    });
    const wss = new ws_1.WebSocketServer({ noServer: true });
    httpServer.on('upgrade', (req, socket, head) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws);
        });
    });
    await new Promise((resolve, reject) => {
        httpServer.listen(0, '127.0.0.1', () => resolve());
        httpServer.on('error', reject);
    });
    const addr = httpServer.address();
    if (!addr || typeof addr === 'string')
        throw new Error('no listen port');
    const url = `ws://127.0.0.1:${addr.port}/`;
    try {
        await run(url, wss);
    }
    finally {
        await new Promise((resolve) => wss.close(() => resolve()));
        await new Promise((resolve, reject) => {
            httpServer.close((err) => (err ? reject(err) : resolve()));
        });
    }
}
function connectClient(url) {
    return new Promise((resolve, reject) => {
        const ws = new ws_1.WebSocket(url);
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
    });
}
async function helloHandshake(plane, url, wss, opts) {
    const sessionId = opts?.sessionId ?? SESSION;
    const generation = opts?.generation ?? GENERATION;
    plane.setExpectedSession({ sessionId, generation });
    const wsPromise = new Promise((resolve) => {
        wss.once('connection', (ws) => {
            plane.attach(ws);
            resolve(ws);
        });
    });
    const client = await connectClient(url);
    client.send(Buffer.from((0, core_1.encodeLoopbackHello)(sessionId, generation)), { binary: true });
    const serverWs = await wsPromise;
    await wait(20);
    return client;
}
async function runNodeDataPlaneUnitTests() {
    await testReplaceClosesPredecessor();
    await testHelloHandshakeEstablished();
    await testGenerationMismatchReject();
    await testStaleCloseDoesNotKillSuccessor();
    await testInvokeOnlyWhenEstablished();
    await testWaitEstablishedSurvivesIntermediateClose();
    console.log('[unit] nodeDataPlane establish protocol ok');
}
async function testReplaceClosesPredecessor() {
    await withServer(async (url, wss) => {
        const plane = new nodeDataPlane_1.NodeDataPlane();
        plane.setExpectedSession({ sessionId: SESSION, generation: GENERATION });
        const clientA = await helloHandshake(plane, url, wss);
        assert_1.default.strictEqual(plane.isEstablished, true);
        assert_1.default.strictEqual(clientA.readyState, ws_1.WebSocket.OPEN);
        const clientB = await helloHandshake(plane, url, wss);
        await wait(30);
        assert_1.default.strictEqual(clientA.readyState, ws_1.WebSocket.CLOSED, 'predecessor must close on replace');
        assert_1.default.strictEqual(clientB.readyState, ws_1.WebSocket.OPEN);
        assert_1.default.strictEqual(plane.isEstablished, true);
        clientB.close();
    });
}
async function testHelloHandshakeEstablished() {
    await withServer(async (url, wss) => {
        const plane = new nodeDataPlane_1.NodeDataPlane();
        plane.setExpectedSession({ sessionId: SESSION, generation: GENERATION });
        const client = await helloHandshake(plane, url, wss);
        assert_1.default.strictEqual(plane.isEstablished, true);
        assert_1.default.strictEqual(plane.status.state, 'established');
        client.close();
    });
}
async function testGenerationMismatchReject() {
    await withServer(async (url, wss) => {
        const plane = new nodeDataPlane_1.NodeDataPlane();
        plane.setExpectedSession({ sessionId: SESSION, generation: GENERATION });
        wss.once('connection', (ws) => plane.attach(ws));
        const client = await connectClient(url);
        client.send(Buffer.from((0, core_1.encodeLoopbackHello)(SESSION, GENERATION + 1)), { binary: true });
        await wait(50);
        assert_1.default.strictEqual(plane.isEstablished, false);
        assert_1.default.strictEqual(client.readyState, ws_1.WebSocket.CLOSED);
        client.close();
    });
}
async function testStaleCloseDoesNotKillSuccessor() {
    await withServer(async (url, wss) => {
        const plane = new nodeDataPlane_1.NodeDataPlane();
        plane.setExpectedSession({ sessionId: SESSION, generation: GENERATION });
        let serverA;
        wss.once('connection', (ws) => {
            serverA = ws;
            plane.attach(ws);
        });
        const clientA = await connectClient(url);
        clientA.send(Buffer.from((0, core_1.encodeLoopbackHello)(SESSION, GENERATION)), { binary: true });
        await wait(30);
        assert_1.default.strictEqual(plane.isEstablished, true);
        wss.once('connection', (ws) => plane.attach(ws));
        const clientB = await connectClient(url);
        clientB.send(Buffer.from((0, core_1.encodeLoopbackHello)(SESSION, GENERATION)), { binary: true });
        await wait(30);
        assert_1.default.strictEqual(plane.isEstablished, true);
        assert_1.default.strictEqual(clientB.readyState, ws_1.WebSocket.OPEN);
        if (serverA) {
            try {
                serverA.close();
            }
            catch {
                /* ignore */
            }
        }
        await wait(20);
        assert_1.default.strictEqual(plane.isEstablished, true, 'stale close must not clear successor');
        clientB.close();
    });
}
async function testInvokeOnlyWhenEstablished() {
    await withServer(async (url, wss) => {
        const plane = new nodeDataPlane_1.NodeDataPlane();
        plane.setExpectedSession({ sessionId: SESSION, generation: GENERATION });
        const notEst = await plane.invoke('applyScrollSet', {});
        assert_1.default.strictEqual(notEst.ok, false);
        assert_1.default.strictEqual(notEst.error?.name, 'not_established');
        const client = await helloHandshake(plane, url, wss);
        client.on('message', (data, isBinary) => {
            if (!isBinary)
                return;
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
            const env = JSON.parse(buf.toString('utf8'));
            if (env.kind === 'invoke' && typeof env.correlationId === 'number') {
                client.send(Buffer.from((0, core_1.encodeLoopbackInvokeResult)(env.correlationId, { ok: true, value: { ok: true } })), { binary: true });
            }
        });
        const ok = await plane.invoke('applyScrollSet', { scrollX: 0, scrollY: 1 });
        assert_1.default.strictEqual(ok.ok, true);
        client.close();
    });
}
/** Doc churn: first socket dies before hello; waiter must survive until successor establishes. */
async function testWaitEstablishedSurvivesIntermediateClose() {
    await withServer(async (url, wss) => {
        const plane = new nodeDataPlane_1.NodeDataPlane();
        plane.setExpectedSession({ sessionId: SESSION, generation: GENERATION });
        const waitPromise = plane.waitEstablished({ generation: GENERATION, timeoutMs: 5_000 });
        wss.once('connection', (ws) => plane.attach(ws));
        const ghost = await connectClient(url);
        await wait(20);
        ghost.close();
        await wait(30);
        assert_1.default.strictEqual(plane.isEstablished, false);
        wss.once('connection', (ws) => plane.attach(ws));
        const client = await connectClient(url);
        client.send(Buffer.from((0, core_1.encodeLoopbackHello)(SESSION, GENERATION)), { binary: true });
        await waitPromise;
        assert_1.default.strictEqual(plane.isEstablished, true);
        client.close();
    });
}
//# sourceMappingURL=nodeDataPlane.unit.js.map