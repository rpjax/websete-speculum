import { WebSocket } from 'ws';
import { BrowserContext, Page } from 'patchright';
import { encodeUrlUpdate, encodeStatusFrame } from '../protocol/wire-protocol';
import { ResizeGuard } from '../ResizeGuard';

/**
 * URL sync on navigation and periodic status publisher.
 */
export class UrlSyncBridge {
    static setupUrlSync(page: Page, ws: WebSocket): void {
        page.on('framenavigated', (frame) => {
            if (frame !== page.mainFrame()) return;
            const currentUrl = page.url();
            if (!/^https?:\/\//i.test(currentUrl)) return;
            if (ws.readyState !== ws.OPEN) return;
            ws.send(encodeUrlUpdate(currentUrl), { binary: true });
        });
    }
}

export class StatusPublisher {
    private _interval: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly _ws:          WebSocket,
        private readonly _context:   BrowserContext,
        private readonly _page:      Page,
        private readonly _resizeGuard: ResizeGuard,
        private readonly _getDimensions: () => { width: number; height: number },
    ) {}

    start(): void {
        this._interval = setInterval(() => this._sendStatus(), 1_000);
    }

    stop(): void {
        if (this._interval !== null) {
            clearInterval(this._interval);
            this._interval = null;
        }
    }

    private _sendStatus(): void {
        if (this._ws.readyState !== this._ws.OPEN) return;
        const { width, height } = this._getDimensions();
        try {
            this._ws.send(encodeStatusFrame({
                tabCount: this._context.pages().length,
                url:      this._page.url(),
                resizing: this._resizeGuard.isActive,
                width,
                height,
            }), { binary: true });
        } catch { /* WS closed mid-send */ }
    }
}
