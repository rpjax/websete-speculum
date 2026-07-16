import { WebSocketServer, WebSocket } from 'ws';
import { VirtualDisplay } from '../browser/VirtualDisplay';
import { RemoteBrowserSession } from '../browser/RemoteBrowserSession';
import { CreateMessage, decodeMessage, type DiagProbeMessage } from '../protocol/wire-protocol';
import { normalizeDeviceProfile } from '../protocol/device-profile';

const MAX_PROBE_RESPONSE_BYTES = 8 * 1024 * 1024; // absolute wire ceiling (matches API validator max)
const DEFAULT_PROBE_RESPONSE_BYTES = 512 * 1024;

/** All input is serialized; mousemove still coalesces inside InputPipeline. */

/** Map CDP / create failures to stable wire errorCode values. */
export function mapSidecarErrorCode(message: string): string {
    const m = message.toLowerCase();
    if (m.includes('network.setcookies') || m.includes('invalid parameters')) {
        return 'cookie_import_invalid';
    }
    return 'sidecar_session_create_failed';
}

export function mapStateExportErrorCode(message: string): string {
    const m = message.toLowerCase();
    if (m.includes('closed') || m.includes('disposed')) {
        return 'export_session_gone';
    }
    return 'export_failed';
}

/**
 * WebSocket session host — one WS connection maps to at most one browser session.
 */
export class WsSessionHost {
    private nextDisplay = 100;
    private readonly activeSessions = new Set<RemoteBrowserSession>();

    attach(wss: WebSocketServer): void {
        wss.on('connection', (ws: WebSocket) => this.handleConnection(ws));
    }

    async shutdown(): Promise<void> {
        const disposeAll = [...this.activeSessions].map(s =>
            s.dispose().catch(err =>
                console.warn('[sidecar] Session dispose error:', (err as Error).message),
            ),
        );
        await Promise.all(disposeAll);
        this.activeSessions.clear();
    }

    private handleConnection(ws: WebSocket): void {
        let session: RemoteBrowserSession | undefined;

        ws.on('message', async (raw: Buffer | string) => {
            const text = typeof raw === 'string' ? raw : raw.toString('utf8');
            const msg  = decodeMessage(text);
            if (!msg) return;

            if (msg.type === 'create') {
                const {
                    sessionId, width, height, url, scripts = [],
                    jsBridgeEnabled = false, allowedNavigationDomains, browserState,
                    mobile, touch, deviceScaleFactor, maxTouchPoints,
                    userAgentProfile, screenOrientation,
                } = msg as CreateMessage;
                const device = normalizeDeviceProfile({
                    mobile, touch, deviceScaleFactor, maxTouchPoints,
                    userAgentProfile, screenOrientation,
                });

                if (session) {
                    console.warn(`[${sessionId}] Duplicate create on existing session — rejecting`);
                    ws.send(JSON.stringify({
                        type:      'error',
                        sessionId,
                        message:   'A session already exists on this connection.',
                        errorCode: 'sidecar_session_create_failed',
                    }));
                    return;
                }

                const displayNum = this.nextDisplay++;
                console.log(`[${sessionId}] Creating session on display :${displayNum}`);

                let display: VirtualDisplay | undefined;
                try {
                    display = await VirtualDisplay.start(displayNum, width, height);

                    session = await RemoteBrowserSession.create(
                        sessionId, ws, display, width, height, url, scripts,
                        jsBridgeEnabled, allowedNavigationDomains, browserState, device,
                    );
                    this.activeSessions.add(session);

                    ws.send(JSON.stringify({ type: 'ready', sessionId }));
                } catch (err) {
                    const message = (err as Error).message;
                    const errorCode = mapSidecarErrorCode(message);
                    console.error(`[${sessionId}] Failed to create session:`, message, `(${errorCode})`);
                    if (display) {
                        display.dispose().catch(dispErr =>
                            console.warn(`[${sessionId}] Display dispose after create failure:`, (dispErr as Error).message),
                        );
                    }
                    ws.send(JSON.stringify({ type: 'error', sessionId, message, errorCode }));
                    ws.close();
                }
                return;
            }

            if (msg.type === 'exportState') {
                if (!session) return;
                try {
                    const state = await session.captureState();
                    ws.send(JSON.stringify({ type: 'stateExport', state }));
                } catch (err) {
                    const message = (err as Error).message;
                    const errorCode = mapStateExportErrorCode(message);
                    console.warn(`[${session?.sessionId}] State export failed:`, message, `(${errorCode})`);
                    if (ws.readyState === ws.OPEN) {
                        ws.send(JSON.stringify({ type: 'stateExportError', message, errorCode }));
                    }
                }
                return;
            }

            if (msg.type === 'diagProbe') {
                const probe = msg as DiagProbeMessage;
                if (!session) {
                    ws.send(JSON.stringify({
                        type:      'diagResult',
                        requestId: probe.requestId,
                        ok:        false,
                        errorCode: 'session_gone',
                    }));
                    return;
                }

                try {
                    const limit = Math.min(
                        MAX_PROBE_RESPONSE_BYTES,
                        typeof probe.maxProbeResponseBytes === 'number' && probe.maxProbeResponseBytes > 0
                            ? probe.maxProbeResponseBytes
                            : DEFAULT_PROBE_RESPONSE_BYTES,
                    );
                    const data = await session.runDiagProbe(probe.ops, {
                        evaluateExpression: probe.evaluateExpression,
                        domSelector:        probe.domSelector,
                        maxProbeResponseBytes: limit,
                    });
                    let payload = JSON.stringify({
                        type:      'diagResult',
                        requestId: probe.requestId,
                        ok:        true,
                        data,
                    });
                    if (Buffer.byteLength(payload, 'utf8') > limit) {
                        payload = JSON.stringify({
                            type:      'diagResult',
                            requestId: probe.requestId,
                            ok:        false,
                            errorCode: 'response_too_large',
                        });
                    }
                    ws.send(payload);
                } catch (err) {
                    const message = (err as Error).message;
                    console.warn(`[${session.sessionId}] Diag probe failed:`, message);
                    if (ws.readyState === ws.OPEN) {
                        ws.send(JSON.stringify({
                            type:      'diagResult',
                            requestId: probe.requestId,
                            ok:        false,
                            errorCode: message.includes('response_too_large')
                                ? 'response_too_large'
                                : message.includes('disposed')
                                    ? 'session_gone'
                                    : 'probe_failed',
                            data:      { message },
                        }));
                    }
                }
                return;
            }

            if (session) {
                // Ordered queue for all input — avoids mousemove racing mousedown/up/touch.
                session.enqueueInput(text);
            }
        });

        ws.on('close', () => {
            if (!session) return;
            const s = session;
            session = undefined;
            this.activeSessions.delete(s);

            s.dispose().catch(err =>
                console.warn('[sidecar] Session dispose error:', (err as Error).message),
            );
        });

        ws.on('error', (err) => {
            console.error('[sidecar] WS error:', err.message);
        });
    }
}
