"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomElementInput = void 0;
/**
 * Dispatches Dom Projection input against elements resolved by page-side id map.
 * Clicks use Playwright/CDP (trusted events).
 *
 * Pass real functions to page.evaluate — string arrow expressions are evaluated
 * (not invoked) when isFunction is false, so they serialize to undefined and
 * silently no-op.
 */
class DomElementInput {
    page;
    projection;
    constructor(page, projection) {
        this.page = page;
        this.projection = projection;
    }
    async dispatch(event) {
        const type = event.type.trim().toLowerCase();
        if (type === 'resync') {
            await this.projection?.requestResync();
            return;
        }
        if (type === 'click') {
            await this.dispatchTrustedClick(event.targetId);
            return;
        }
        await this.page.evaluate(({ type: eventType, targetId, payloadJson }) => {
            const payload = (() => {
                try {
                    const v = JSON.parse(payloadJson);
                    return v && typeof v === 'object' ? v : {};
                }
                catch {
                    return {};
                }
            })();
            const w = globalThis;
            const el = w.__speculumDomResolve?.(targetId);
            if (!el)
                return;
            if (eventType === 'input' || eventType === 'change') {
                const value = typeof payload.value === 'string' ? payload.value : '';
                if ('value' in el)
                    el.value = value;
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
                }
                else {
                    el.scrollTop = top;
                    el.scrollLeft = left;
                }
            }
        }, {
            type,
            targetId: event.targetId,
            payloadJson: event.payloadJson ?? '{}',
        });
    }
    async dispatchTrustedClick(targetId) {
        const handle = await this.page.evaluateHandle((id) => {
            const w = globalThis;
            return w.__speculumDomResolve?.(id) ?? null;
        }, targetId);
        try {
            const element = handle.asElement();
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
            }
            catch {
                const box = await element.boundingBox().catch(() => null);
                if (box) {
                    await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                    return;
                }
                // Last resort: DOM click() in page (untrusted but hits React delegation).
                await element.evaluate((el) => {
                    const node = el;
                    node.click?.();
                });
            }
        }
        finally {
            await handle.dispose().catch(() => undefined);
        }
    }
}
exports.DomElementInput = DomElementInput;
//# sourceMappingURL=DomElementInput.js.map