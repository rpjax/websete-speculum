import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { WsSessionHost } from '../transport/WsSessionHost';
import { VirtualDisplay } from '../browser/VirtualDisplay';
import { RemoteBrowserSession } from '../browser/RemoteBrowserSession';
import { BrowserStatePayload } from '../BrowserState';

function listen(server: http.Server): Promise<number> {
    return new Promise((resolve, reject) => {
        server.listen(0, () => {
            const addr = server.address();
            if (!addr || typeof addr === 'string') {
                reject(new Error('Failed to bind ephemeral port'));
                return;
            }
            resolve(addr.port);
        });
        server.on('error', reject);
    });
}

function closeServer(server: http.Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
    });
}

function openWebSocket(port: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
    });
}

function waitForJsonMessage(ws: WebSocket): Promise<unknown> {
    return new Promise((resolve, reject) => {
        ws.once('message', (data) => {
            try {
                resolve(JSON.parse(data.toString()));
            } catch (err) {
                reject(err);
            }
        });
        ws.once('error', reject);
    });
}

test('WsSessionHost responds ready to create handshake', async () => {
    const host   = new WsSessionHost();
    const server = http.createServer();
    const wss    = new WebSocketServer({ server });
    host.attach(wss);

    const origDisplayStart = VirtualDisplay.start;
    const origSessionCreate = RemoteBrowserSession.create;

    VirtualDisplay.start = async (number, width, height) => ({
        number,
        displayEnv: `:${number}`,
        dispose: async () => {},
    } as unknown as VirtualDisplay);

    RemoteBrowserSession.create = async (sessionId) => ({
        sessionId,
        dispose: async () => {},
        handleMessage: async () => {},
        captureState: async () => ({} as BrowserStatePayload),
    } as unknown as RemoteBrowserSession);

    let port = 0;
    try {
        port = await listen(server);

        const ws = await openWebSocket(port);
        const responsePromise = waitForJsonMessage(ws);

        ws.send(JSON.stringify({
            type:      'create',
            sessionId: 'handshake-test',
            width:     1280,
            height:    720,
        }));

        const response = await responsePromise as { type: string; sessionId: string };
        assert.equal(response.type, 'ready');
        assert.equal(response.sessionId, 'handshake-test');

        ws.close();
        await host.shutdown();
    } finally {
        VirtualDisplay.start = origDisplayStart;
        RemoteBrowserSession.create = origSessionCreate;
        await closeServer(server);
    }
});

test('WsSessionHost rejects duplicate create on same connection', async () => {
    const host   = new WsSessionHost();
    const server = http.createServer();
    const wss    = new WebSocketServer({ server });
    host.attach(wss);

    const origDisplayStart = VirtualDisplay.start;
    const origSessionCreate = RemoteBrowserSession.create;

    VirtualDisplay.start = async (number) => ({
        number,
        displayEnv: `:${number}`,
        dispose: async () => {},
    } as unknown as VirtualDisplay);

    RemoteBrowserSession.create = async (sessionId) => ({
        sessionId,
        dispose: async () => {},
        handleMessage: async () => {},
        captureState: async () => ({} as BrowserStatePayload),
    } as unknown as RemoteBrowserSession);

    let port = 0;
    try {
        port = await listen(server);

        const ws = await openWebSocket(port);

        ws.send(JSON.stringify({
            type:      'create',
            sessionId: 'dup-test',
            width:     800,
            height:    600,
        }));

        const ready = await waitForJsonMessage(ws) as { type: string };
        assert.equal(ready.type, 'ready');

        ws.send(JSON.stringify({
            type:      'create',
            sessionId: 'dup-test',
            width:     800,
            height:    600,
        }));

        const error = await waitForJsonMessage(ws) as { type: string; message: string };
        assert.equal(error.type, 'error');
        assert.match(error.message, /already exists/i);

        ws.close();
        await host.shutdown();
    } finally {
        VirtualDisplay.start = origDisplayStart;
        RemoteBrowserSession.create = origSessionCreate;
        await closeServer(server);
    }
});
