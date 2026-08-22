/**
 * Host-side CDP binding bridge — Virtual frames arrive via Playwright exposeBinding.
 * No page WebSocket (E-03).
 */

import type { BrowserContext, Page } from 'patchright';
import { decodePlaneEnvelope, encodePlaneEnvelope, PlaneChannel } from '@speculum/page-projection/core/plane';

export type CdpPlaneHandler = (channel: number, payload: Uint8Array) => void;

export class CdpBindingDataPlaneHost {
  private handler: CdpPlaneHandler | null = null;
  private attached = false;

  setHandler(handler: CdpPlaneHandler | null): void {
    this.handler = handler;
  }

  async attach(context: BrowserContext): Promise<void> {
    if (this.attached) return;
    await context.exposeBinding(
      '__speculumCdpPlane',
      (_source, _channel: number, payloadB64: string) => {
        try {
          const raw = Buffer.from(String(payloadB64), 'base64');
          const env = decodePlaneEnvelope(new Uint8Array(raw));
          if (!env) return;
          this.handler?.(env.channel, env.payload);
        } catch {
          /* ignore malformed */
        }
      },
    );
    this.attached = true;
  }

  async sendControl(page: Page, message: Record<string, unknown>): Promise<void> {
    const envelope = encodePlaneEnvelope(
      PlaneChannel.Control,
      new TextEncoder().encode(JSON.stringify(message)),
    );
    let s = '';
    for (let i = 0; i < envelope.length; i++) s += String.fromCharCode(envelope[i]!);
    const b64 = Buffer.from(envelope).toString('base64');
    await page.evaluate((bytesB64) => {
      const deliver = (globalThis as { __speculumCdpControlDeliver?: (b: string) => void })
        .__speculumCdpControlDeliver;
      if (typeof deliver === 'function') deliver(bytesB64);
    }, b64);
    void s;
  }

  close(): void {
    this.handler = null;
  }
}
