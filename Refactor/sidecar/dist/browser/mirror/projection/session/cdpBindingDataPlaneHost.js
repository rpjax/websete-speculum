"use strict";
/**
 * Host-side CDP binding bridge — Virtual frames arrive via Playwright exposeBinding.
 * No page WebSocket (E-03).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CdpBindingDataPlaneHost = void 0;
const plane_1 = require("@speculum/page-projection/core/plane");
class CdpBindingDataPlaneHost {
    handler = null;
    attached = false;
    setHandler(handler) {
        this.handler = handler;
    }
    async attach(context) {
        if (this.attached)
            return;
        await context.exposeBinding('__speculumCdpPlane', (_source, _channel, payloadB64) => {
            try {
                const raw = Buffer.from(String(payloadB64), 'base64');
                const env = (0, plane_1.decodePlaneEnvelope)(new Uint8Array(raw));
                if (!env)
                    return;
                this.handler?.(env.channel, env.payload);
            }
            catch {
                /* ignore malformed */
            }
        });
        this.attached = true;
    }
    async sendControl(page, message) {
        const envelope = (0, plane_1.encodePlaneEnvelope)(plane_1.PlaneChannel.Control, new TextEncoder().encode(JSON.stringify(message)));
        let s = '';
        for (let i = 0; i < envelope.length; i++)
            s += String.fromCharCode(envelope[i]);
        const b64 = Buffer.from(envelope).toString('base64');
        await page.evaluate((bytesB64) => {
            const deliver = globalThis
                .__speculumCdpControlDeliver;
            if (typeof deliver === 'function')
                deliver(bytesB64);
        }, b64);
        void s;
    }
    close() {
        this.handler = null;
    }
}
exports.CdpBindingDataPlaneHost = CdpBindingDataPlaneHost;
//# sourceMappingURL=cdpBindingDataPlaneHost.js.map