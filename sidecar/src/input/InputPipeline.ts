import { Page, CDPSession } from 'patchright';
import { decodeMessage } from '../protocol/wire-protocol';
import { ScreencastPipeline } from '../browser/ScreencastPipeline';
import { MouseMoveCoalescer } from '../MouseMoveCoalescer';
import { NavigationGeneration } from '../NavigationGeneration';
import { ResizeGuard } from '../ResizeGuard';

/** Maps DOM MouseEvent.button (0=left, 1=middle, 2=right) → Playwright button name. */
function domButton(b: number): 'left' | 'middle' | 'right' {
    if (b === 1) return 'middle';
    if (b === 2) return 'right';
    return 'left';
}

export type InputPipelineDeps = {
    sessionId:       string;
    page:            Page;
    cdp:             CDPSession;
    capture:         ScreencastPipeline;
    onFrame:         (buf: Buffer) => void;
    jsBridgeEnabled: boolean;
    onEvalJs:        (id: number, code: string) => Promise<void>;
    isExporting:     () => boolean;
    isDisposed:      () => boolean;
    getDimensions:   () => { width: number; height: number };
    setDimensions:   (width: number, height: number) => void;
};

/**
 * Decodes wire input messages and dispatches pointer, keyboard, navigation, resize.
 */
export class InputPipeline {
    private readonly _resizeGuard = new ResizeGuard();
    private readonly _navigation  = new NavigationGeneration();
    private readonly _mouseMoveCoalescer: MouseMoveCoalescer;

    constructor(private readonly _deps: InputPipelineDeps) {
        this._mouseMoveCoalescer = new MouseMoveCoalescer((x, y) => {
            if (this._deps.isExporting() || this._deps.isDisposed()) return;
            this._deps.page.mouse.move(x, y).catch(() => {});
        });
    }

    get resizeGuard(): ResizeGuard {
        return this._resizeGuard;
    }

    async handleMessage(raw: string): Promise<void> {
        if (this._deps.isExporting()) return;

        const msg = decodeMessage(raw);
        if (!msg || msg.type === 'create') return;

        try {
            switch (msg.type) {
                case 'navigate': {
                    const url = msg.url;
                    if (!url.startsWith('http://') && !url.startsWith('https://')) break;
                    await this._runNavigation(() =>
                        this._deps.page.goto(url, {
                            waitUntil: 'domcontentloaded',
                            timeout:   30_000,
                        }),
                    );
                    break;
                }

                case 'refresh':
                    await this._runNavigation(() =>
                        this._deps.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }),
                    );
                    break;

                case 'mousemove':
                    this._queueMouseMove(msg.x, msg.y);
                    break;

                case 'mousedown':
                    await this._deps.page.mouse.move(msg.x, msg.y);
                    await this._deps.page.mouse.down({ button: domButton(msg.button) });
                    break;

                case 'mouseup':
                    await this._deps.page.mouse.move(msg.x, msg.y);
                    await this._deps.page.mouse.up({ button: domButton(msg.button) });
                    break;

                case 'wheel':
                    await this._deps.page.mouse.move(msg.x, msg.y);
                    await this._deps.page.mouse.wheel(msg.deltaX, msg.deltaY);
                    break;

                case 'keydown':
                    if (msg.key.length === 1 && msg.key.charCodeAt(0) > 127) {
                        await this._deps.page.keyboard.type(msg.key);
                    } else {
                        await this._deps.page.keyboard.down(msg.key);
                    }
                    break;

                case 'keyup':
                    if (msg.key.length === 1 && msg.key.charCodeAt(0) > 127) break;
                    await this._deps.page.keyboard.up(msg.key);
                    break;

                case 'type':
                    await this._deps.page.keyboard.type(msg.text);
                    break;

                case 'goback':
                    await this._runNavigation(() =>
                        this._deps.page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }),
                    );
                    break;

                case 'goforward':
                    await this._runNavigation(() =>
                        this._deps.page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 }),
                    );
                    break;

                case 'evaljs':
                    if (this._deps.jsBridgeEnabled) await this._deps.onEvalJs(msg.id, msg.code);
                    break;

                case 'resize':
                    await this._handleResize(msg.width, msg.height);
                    break;
            }
        } catch (err) {
            console.warn(`[${this._deps.sessionId}] Input error (${msg.type}):`, (err as Error).message);
        }
    }

    private _queueMouseMove(x: number, y: number): void {
        if (this._deps.isExporting()) return;
        this._mouseMoveCoalescer.queue(x, y);
    }

    private async _runNavigation(action: () => Promise<unknown>): Promise<void> {
        const generation = this._navigation.begin();
        try {
            await action();
            if (!this._navigation.isCurrent(generation)) return;
        } catch (err) {
            if (this._navigation.isCurrent(generation)) {
                console.warn(
                    `[${this._deps.sessionId}] Navigation error:`,
                    (err as Error).message,
                );
            }
        }
    }

    private async _handleResize(w: number, h: number): Promise<void> {
        if (!this._resizeGuard.tryBegin()) return;
        const { width, height } = this._deps.getDimensions();
        if (w === width && h === height) {
            this._resizeGuard.end();
            return;
        }
        if (w < 100 || h < 100) {
            this._resizeGuard.end();
            return;
        }

        try {
            console.log(`[${this._deps.sessionId}] Resize → ${w}×${h}`);

            try {
                await this._deps.cdp.send('Emulation.setDeviceMetricsOverride', {
                    width: w, height: h,
                    deviceScaleFactor: 1,
                    mobile: false,
                });
            } catch { /* CDP session may have been recycled — best-effort */ }

            await this._deps.capture.restart(w, h, this._deps.onFrame);

            this._deps.setDimensions(w, h);
            console.log(`[${this._deps.sessionId}] Resize complete → ${w}×${h}`);
        } catch (err) {
            console.error(`[${this._deps.sessionId}] Resize failed:`, (err as Error).message);
        } finally {
            this._resizeGuard.end();
        }
    }
}
