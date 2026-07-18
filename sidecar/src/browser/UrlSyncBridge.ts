import { WebSocket } from 'ws';
import { BrowserContext, Page } from 'patchright';
import { encodeUrlUpdate, encodeStatusFrame, type EditingState } from '../protocol/wire-protocol';

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
    private _editing: EditingState | null = null;
    private _statusGen = 0;
    private _inFlight = false;
    private _context: BrowserContext;
    private _page: Page;

    constructor(
        private readonly _ws: WebSocket,
        context: BrowserContext,
        page: Page,
        private readonly _isResizing: () => boolean,
        private readonly _getDimensions: () => { width: number; height: number },
    ) {
        this._context = context;
        this._page = page;
    }

    rebind(context: BrowserContext, page: Page): void {
        this._context = context;
        this._page = page;
        this._statusGen++;
        this._editing = null;
    }

    start(): void {
        this._interval = setInterval(() => this._sendStatus(), 1_000);
    }

    stop(): void {
        if (this._interval !== null) {
            clearInterval(this._interval);
            this._interval = null;
        }
        this._statusGen++;
    }

    private async _refreshEditing(gen: number): Promise<void> {
        try {
            // String form avoids pulling DOM lib types into the Node sidecar compile.
            const editing = await this._page.evaluate(`(() => {
                function resolveActive(doc) {
                    const el = doc.activeElement;
                    if (!el) return null;
                    if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
                        try {
                            const child = el.contentDocument;
                            if (child) return resolveActive(child);
                        } catch { /* cross-origin */ }
                        return null;
                    }
                    return el;
                }
                const el = resolveActive(document);
                if (!el) return null;
                const tag = el.tagName.toLowerCase();
                const TEXT_INPUT_TYPES = new Set([
                    '', 'text', 'search', 'email', 'tel', 'url', 'password', 'number',
                    'date', 'datetime-local', 'month', 'time', 'week',
                ]);
                let editable = false;
                if (tag === 'textarea') {
                    editable = !el.readOnly && !el.disabled;
                } else if (tag === 'input') {
                    const type = (el.getAttribute('type') || el.type || 'text').toLowerCase();
                    editable = TEXT_INPUT_TYPES.has(type) && !el.readOnly && !el.disabled;
                } else if (el.isContentEditable) {
                    editable = true;
                }
                if (!editable) return null;
                return {
                    focused: true,
                    inputMode: el.inputMode || el.getAttribute('inputmode') || 'text',
                    multiline: tag === 'textarea' || !!el.isContentEditable,
                    tagName: tag,
                };
            })()`) as EditingState | null;
            if (gen !== this._statusGen) return;
            this._editing = editing;
        } catch {
            if (gen !== this._statusGen) return;
            this._editing = null;
        }
    }

    private _sendStatus(): void {
        if (this._ws.readyState !== this._ws.OPEN) return;
        // Skip overlapping probes — next tick will catch up with fresh focus state.
        if (this._inFlight) return;
        this._inFlight = true;
        const gen = ++this._statusGen;
        const { width, height } = this._getDimensions();
        void this._refreshEditing(gen).then(() => {
            this._inFlight = false;
            if (gen !== this._statusGen) return;
            if (this._ws.readyState !== this._ws.OPEN) return;
            try {
                this._ws.send(encodeStatusFrame({
                    tabCount: this._context.pages().length,
                    url:      this._page.url(),
                    resizing: this._isResizing(),
                    width,
                    height,
                    editing:  this._editing,
                }), { binary: true });
            } catch { /* WS closed mid-send */ }
        }).catch(() => {
            this._inFlight = false;
        });
    }
}
