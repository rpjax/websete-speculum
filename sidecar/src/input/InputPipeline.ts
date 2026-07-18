import { Page, CDPSession } from 'patchright';
import { decodeMessage, type TouchPoint } from '../protocol/wire-protocol';
import { MouseMoveCoalescer } from '../MouseMoveCoalescer';
import { NavigationGeneration } from '../NavigationGeneration';
import { normalizeWheelDeltas } from './wheel-defaults';
import { normalizeDeviceProfile, type DeviceProfile } from '../protocol/device-profile';
import { TouchMoveCoalescer } from './TouchMoveCoalescer';
import type { SessionViewport } from '../browser/SessionViewport';

export { normalizeWheelDeltas } from './wheel-defaults';

/** Maps DOM MouseEvent.button (0=left, 1=middle, 2=right) → Playwright button name. */
function domButton(b: number): 'left' | 'middle' | 'right' {
    if (b === 1) return 'middle';
    if (b === 2) return 'right';
    return 'left';
}

function cdpTouchType(phase: string): 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel' {
    switch (phase) {
        case 'move': return 'touchMove';
        case 'end': return 'touchEnd';
        case 'cancel': return 'touchCancel';
        default: return 'touchStart';
    }
}

function toCdpPoints(points: TouchPoint[]): Array<{
    x: number; y: number; id: number; radiusX: number; radiusY: number; force: number;
}> {
    return points.map((p) => ({
        x: p.x,
        y: p.y,
        id: p.id,
        radiusX: p.radiusX ?? 1,
        radiusY: p.radiusY ?? 1,
        force: p.force ?? 0.5,
    }));
}

export type InputPipelineDeps = {
    sessionId:       string;
    page:            Page;
    cdp:             CDPSession;
    jsBridgeEnabled: boolean;
    onEvalJs:        (id: number, code: string) => Promise<void>;
    isExporting:     () => boolean;
    isDisposed:      () => boolean;
    getViewport:     () => SessionViewport;
    /** Runtime resize — returns wire resizeResult fields (caller sends). */
    onResize:        (req: {
        requestId: string;
        width: number;
        height: number;
        device: DeviceProfile;
    }) => Promise<{
        ok: boolean;
        width: number;
        height: number;
        chromeWidth?: number;
        chromeHeight?: number;
        displayWidth?: number;
        displayHeight?: number;
        errorCode?: string;
        phase?: string;
        message?: string;
    }>;
    sendResizeResult: (result: {
        requestId: string;
        ok: boolean;
        width: number;
        height: number;
        chromeWidth?: number;
        chromeHeight?: number;
        displayWidth?: number;
        displayHeight?: number;
        errorCode?: string;
        phase?: string;
        message?: string;
    }) => void;
};

/**
 * Decodes wire input messages and dispatches pointer, touch, keyboard, navigation.
 * Viewport mutation is owned by SessionViewport via onResize.
 */
export class InputPipeline {
    private readonly _navigation  = new NavigationGeneration();
    private readonly _mouseMoveCoalescer: MouseMoveCoalescer;
    private readonly _touchMoveCoalescer: TouchMoveCoalescer;
    private _inputChain: Promise<void> = Promise.resolve();
    private _page: Page;
    private _cdp: CDPSession;

    constructor(private readonly _deps: InputPipelineDeps) {
        this._page = _deps.page;
        this._cdp = _deps.cdp;
        this._mouseMoveCoalescer = new MouseMoveCoalescer((x, y) => {
            if (this._deps.isExporting() || this._deps.isDisposed()) return;
            if (this._isTouchPrimary()) return;
            this._page.mouse.move(x, y).catch(() => {});
        });
        this._touchMoveCoalescer = new TouchMoveCoalescer((points) => {
            if (this._deps.isExporting() || this._deps.isDisposed()) return;
            this._inputChain = this._inputChain
                .then(() => this._dispatchTouch('move', points))
                .catch((err) => {
                    console.warn(`[${this._deps.sessionId}] Touch move error:`, (err as Error).message);
                });
        });
    }

    /** After display/Chrome recreate, point dispatch at the new page/CDP. */
    rebind(page: Page, cdp: CDPSession): void {
        this._page = page;
        this._cdp = cdp;
    }

    /** Serialize decisive input; mousemove / touchmove still coalesce separately. */
    enqueue(raw: string): void {
        this._inputChain = this._inputChain
            .then(() => this.handleMessage(raw))
            .catch((err) => {
                console.warn(`[${this._deps.sessionId}] Input queue error:`, (err as Error).message);
            });
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
                        this._page.goto(url, {
                            waitUntil: 'domcontentloaded',
                            timeout:   30_000,
                        }),
                    );
                    break;
                }

                case 'refresh':
                    await this._runNavigation(() =>
                        this._page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }),
                    );
                    break;

                case 'mousemove':
                    if (this._isTouchPrimary()) break;
                    this._queueMouseMove(msg.x, msg.y);
                    break;

                case 'mousedown':
                    if (this._isTouchPrimary()) break;
                    await this._page.mouse.move(msg.x, msg.y);
                    await this._page.mouse.down({ button: domButton(msg.button) });
                    break;

                case 'mouseup':
                    if (this._isTouchPrimary()) break;
                    await this._page.mouse.move(msg.x, msg.y);
                    await this._page.mouse.up({ button: domButton(msg.button) });
                    break;

                case 'wheel': {
                    const { deltaX, deltaY } = normalizeWheelDeltas(msg);
                    if (!this._isTouchPrimary()) {
                        await this._page.mouse.move(msg.x, msg.y);
                    }
                    await this._page.mouse.wheel(deltaX, deltaY);
                    break;
                }

                case 'touch':
                    if (msg.phase === 'move') {
                        this._touchMoveCoalescer.queue(msg.points);
                        break;
                    }
                    {
                        const pendingMove = this._touchMoveCoalescer.takePending();
                        if (pendingMove) await this._dispatchTouch('move', pendingMove);
                    }
                    await this._dispatchTouch(msg.phase, msg.points);
                    break;

                case 'keydown':
                    if (msg.key.length === 1 && msg.key.charCodeAt(0) > 127) {
                        await this._page.keyboard.type(msg.key);
                    } else {
                        await this._page.keyboard.down(msg.key);
                    }
                    break;

                case 'keyup':
                    if (msg.key.length === 1 && msg.key.charCodeAt(0) > 127) break;
                    await this._page.keyboard.up(msg.key);
                    break;

                case 'type':
                    await this._page.keyboard.type(msg.text);
                    break;

                case 'text':
                    await this._insertText(msg.text);
                    break;

                case 'goback':
                    await this._runNavigation(() =>
                        this._page.goBack({ waitUntil: 'commit', timeout: 30_000 }),
                    );
                    break;

                case 'goforward':
                    await this._runNavigation(() =>
                        this._page.goForward({ waitUntil: 'commit', timeout: 30_000 }),
                    );
                    break;

                case 'evaljs':
                    if (this._deps.jsBridgeEnabled) await this._deps.onEvalJs(msg.id, msg.code);
                    break;

                case 'resize': {
                    const requestId = typeof msg.requestId === 'string' && msg.requestId.length > 0
                        ? msg.requestId
                        : `anon-${Date.now()}`;
                    const device = normalizeDeviceProfile({
                        mobile: msg.mobile,
                        touch: msg.touch,
                        deviceScaleFactor: msg.deviceScaleFactor,
                        maxTouchPoints: msg.maxTouchPoints,
                        userAgentProfile: msg.userAgentProfile,
                        screenOrientation: msg.screenOrientation,
                    });
                    const result = await this._deps.onResize({
                        requestId,
                        width: msg.width,
                        height: msg.height,
                        device,
                    });
                    this._deps.sendResizeResult({ requestId, ...result });
                    break;
                }
            }
        } catch (err) {
            console.warn(`[${this._deps.sessionId}] Input error (${msg.type}):`, (err as Error).message);
        }
    }

    /** Phone-like only — hybrid desktop (touch=true, mobile=false) must keep mouse clicks. */
    private _isTouchPrimary(): boolean {
        return !!this._deps.getViewport().device.mobile;
    }

    private async _dispatchTouch(
        phase: string,
        points: TouchPoint[],
    ): Promise<void> {
        if (phase === 'end' || phase === 'cancel') {
            await this._cdp.send('Input.dispatchTouchEvent', {
                type: cdpTouchType(phase),
                touchPoints: [],
            });
            if (points.length > 0) {
                await this._cdp.send('Input.dispatchTouchEvent', {
                    type: 'touchStart',
                    touchPoints: toCdpPoints(points),
                });
            }
            return;
        }

        await this._cdp.send('Input.dispatchTouchEvent', {
            type: cdpTouchType(phase),
            touchPoints: toCdpPoints(points),
        });
    }

    private async _insertText(text: string): Promise<void> {
        try {
            await this._cdp.send('Input.insertText', { text });
        } catch {
            await this._page.keyboard.type(text);
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
}
