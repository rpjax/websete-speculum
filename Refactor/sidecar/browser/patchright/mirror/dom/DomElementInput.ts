import type { ElementHandle, Page } from 'patchright';
import type { DomProjection } from './DomProjection';

export type DomElementInputEvent = {
  type: string;
  targetId: number;
  payloadJson?: string;
};

/**
 * Dispatches Dom Projection input against elements resolved by page-side id map.
 * Clicks use Playwright/CDP (trusted events).
 *
 * Pass real functions to page.evaluate — string arrow expressions are evaluated
 * (not invoked) when isFunction is false, so they serialize to undefined and
 * silently no-op.
 */
export class DomElementInput {
  constructor(
    private readonly page: Page,
    private readonly projection?: DomProjection,
  ) {}

  async dispatch(event: DomElementInputEvent): Promise<void> {
    const type = event.type.trim().toLowerCase();
    if (type === 'resync') {
      await this.projection?.requestResync();
      return;
    }
    if (type === 'click') {
      await this.dispatchTrustedClick(event.targetId);
      return;
    }
    await this.page.evaluate(
      ({ type: eventType, targetId, payloadJson }) => {
        const payload = (() => {
          try {
            const v = JSON.parse(payloadJson) as unknown;
            return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
          } catch {
            return {};
          }
        })();
        const w = globalThis as typeof globalThis & {
          __speculumDomResolve?: (id: number) => {
            value?: string;
            scrollTop?: number;
            scrollLeft?: number;
            dispatchEvent: (e: Event) => boolean;
          } | null;
          document: {
            documentElement: unknown;
            body: unknown;
          };
          scrollTo: (x: number, y: number) => void;
          Event: new (type: string, init?: object) => Event;
          KeyboardEvent: new (type: string, init?: object) => Event;
        };
        const el = w.__speculumDomResolve?.(targetId);
        if (!el) return;
        if (eventType === 'input' || eventType === 'change') {
          const value = typeof payload.value === 'string' ? payload.value : '';
          if ('value' in el) el.value = value;
          el.dispatchEvent(new w.Event('input', { bubbles: true }));
          el.dispatchEvent(new w.Event('change', { bubbles: true }));
          return;
        }
        if (eventType === 'keydown' || eventType === 'keyup') {
          const key = typeof payload.key === 'string' ? payload.key : '';
          el.dispatchEvent(new w.KeyboardEvent(eventType, { key, bubbles: true, cancelable: true }));
          return;
        }
        if (eventType === 'scroll') {
          const top = typeof payload.scrollTop === 'number' ? payload.scrollTop : 0;
          const left = typeof payload.scrollLeft === 'number' ? payload.scrollLeft : 0;
          if (el === w.document.documentElement || el === w.document.body) {
            w.scrollTo(left, top);
          } else {
            el.scrollTop = top;
            el.scrollLeft = left;
          }
        }
      },
      {
        type,
        targetId: event.targetId,
        payloadJson: event.payloadJson ?? '{}',
      },
    );
  }

  private async dispatchTrustedClick(targetId: number): Promise<void> {
    const handle = await this.page.evaluateHandle((id) => {
      const w = globalThis as typeof globalThis & {
        __speculumDomResolve?: (id: number) => unknown;
      };
      return w.__speculumDomResolve?.(id) ?? null;
    }, targetId);
    try {
      const element = handle.asElement() as ElementHandle | null;
      if (!element) {
        // Id map miss — fall back to attribute stamped only on the client; try text/role on remote.
        return;
      }
      try {
        await element.click({
          force: true,
          timeout: 2_000,
          noWaitAfter: true,
        });
      } catch {
        const box = await element.boundingBox().catch(() => null);
        if (box) {
          await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          return;
        }
        // Last resort: DOM click() in page (untrusted but hits React delegation).
        await element.evaluate((el) => {
          const node = el as { click?: () => void };
          node.click?.();
        });
      }
    } finally {
      await handle.dispose().catch(() => undefined);
    }
  }
}
