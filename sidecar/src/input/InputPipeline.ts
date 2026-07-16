import { Page, CDPSession } from 'patchright';
import { decodeMessage, type TouchPoint } from '../protocol/wire-protocol';
import { ScreencastPipeline } from '../browser/ScreencastPipeline';
import { MouseMoveCoalescer } from '../MouseMoveCoalescer';
import { NavigationGeneration } from '../NavigationGeneration';
import { ResizeGuard } from '../ResizeGuard';
import { normalizeWheelDeltas } from './wheel-defaults';
import { normalizeDeviceProfile, type DeviceProfile } from '../protocol/device-profile';
import { applyDeviceEmulation } from './device-emulation';

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
    capture:         ScreencastPipeline;
    onFrame:         (buf: Buffer) => void;
    jsBridgeEnabled: boolean;
    onEvalJs:        (id: number, code: string) => Promise<void>;
    isExporting:     () => boolean;
    isDisposed:      () => boolean;
    getDimensions:   () => { width: number; height: number };
    setDimensions:   (width: number, height: number) => void;
    getDevice:       () => DeviceProfile;
    setDevice:       (device: DeviceProfile) => void;
};

/**
 * Decodes wire input messages and dispatches pointer, touch, keyboard, navigation, resize.
 */
export class InputPipeline {
    private readonly _resizeGuard = new ResizeGuard();
    private readonly _navigation  = new NavigationGeneration();
    private readonly _mouseMoveCoalescer: MouseMoveCoalescer;
    private _inputChain: Promise<void> = Promise.resolve();

    constructor(private readonly _deps: InputPipelineDeps) {
        this._mouseMoveCoalescer = new MouseMoveCoalescer((x, y) => {
            if (this._deps.isExporting() || this._deps.isDisposed()) return;
            this._deps.page.mouse.move(x, y).catch(() => {});
        });
    }

    get resizeGuard(): ResizeGuard {
        return this._resizeGuard;
    }

    /** Serialize decisive input; mousemove still coalesces separately. */
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

                case 'wheel': {
                    const { deltaX, deltaY } = normalizeWheelDeltas(msg);
                    await this._deps.page.mouse.move(msg.x, msg.y);
                    await this._deps.page.mouse.wheel(deltaX, deltaY);
                    break;
                }

                case 'touch':
                    await this._dispatchTouch(msg.phase, msg.points);
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

                case 'text':
                    await this._insertText(msg.text);
                    break;

                case 'goback':
                    // commit: bfcache restores often skip DOMContentLoaded, which hung goBack for 30s.
                    await this._runNavigation(() =>
                        this._deps.page.goBack({ waitUntil: 'commit', timeout: 30_000 }),
                    );
                    break;

                case 'goforward':
                    await this._runNavigation(() =>
                        this._deps.page.goForward({ waitUntil: 'commit', timeout: 30_000 }),
                    );
                    break;

                case 'evaljs':
                    if (this._deps.jsBridgeEnabled) await this._deps.onEvalJs(msg.id, msg.code);
                    break;

                case 'resize':
                    await this._handleResize(msg.width, msg.height, normalizeDeviceProfile({
                        mobile: msg.mobile,
                        touch: msg.touch,
                        deviceScaleFactor: msg.deviceScaleFactor,
                        maxTouchPoints: msg.maxTouchPoints,
                        userAgentProfile: msg.userAgentProfile,
                        screenOrientation: msg.screenOrientation,
                    }));
                    break;
            }
        } catch (err) {
            console.warn(`[${this._deps.sessionId}] Input error (${msg.type}):`, (err as Error).message);
        }
    }

    private async _dispatchTouch(
        phase: string,
        points: TouchPoint[],
    ): Promise<void> {
        // CDP: TouchEnd/TouchCancel must have zero points; TouchStart/Move need ≥1.
        // For a partial lift the wire still carries remaining contacts — end with []
        // then re-assert remaining via touchStart so other fingers stay active.
        if (phase === 'end' || phase === 'cancel') {
            await this._deps.cdp.send('Input.dispatchTouchEvent', {
                type: cdpTouchType(phase),
                touchPoints: [],
            });
            if (points.length > 0) {
                await this._deps.cdp.send('Input.dispatchTouchEvent', {
                    type: 'touchStart',
                    touchPoints: toCdpPoints(points),
                });
            }
            return;
        }

        await this._deps.cdp.send('Input.dispatchTouchEvent', {
            type: cdpTouchType(phase),
            touchPoints: toCdpPoints(points),
        });
    }

    private async _insertText(text: string): Promise<void> {
        try {
            await this._deps.cdp.send('Input.insertText', { text });
        } catch {
            await this._deps.page.keyboard.type(text);
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

    private async _handleResize(w: number, h: number, device: DeviceProfile): Promise<void> {
        if (!this._resizeGuard.tryBegin()) return;
        const { width, height } = this._deps.getDimensions();
        const current = this._deps.getDevice();
        const sameSize = w === width && h === height;
        const sameDevice =
            current.mobile === device.mobile
            && current.touch === device.touch
            && current.deviceScaleFactor === device.deviceScaleFactor
            && current.maxTouchPoints === device.maxTouchPoints
            && current.userAgentProfile === device.userAgentProfile
            && current.screenOrientation === device.screenOrientation;
        if (sameSize && sameDevice) {
            this._resizeGuard.end();
            return;
        }
        if (w < 100 || h < 100) {
            this._resizeGuard.end();
            return;
        }

        try {
            console.log(`[${this._deps.sessionId}] Resize → ${w}×${h} mobile=${device.mobile}`);
            await applyDeviceEmulation(this._deps.cdp, w, h, device);
            if (!sameSize) {
                await this._deps.capture.restart(w, h, this._deps.onFrame);
            }
            this._deps.setDimensions(w, h);
            this._deps.setDevice(device);
            console.log(`[${this._deps.sessionId}] Resize complete → ${w}×${h}`);
        } catch (err) {
            console.error(`[${this._deps.sessionId}] Resize failed:`, (err as Error).message);
        } finally {
            this._resizeGuard.end();
        }
    }
}
