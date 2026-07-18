import { Page, CDPSession } from 'patchright';
import type { DeviceProfile } from '../protocol/device-profile';
import { VirtualDisplay } from './VirtualDisplay';
import { applyDeviceEmulation, readChromeViewport } from '../input/device-emulation';
import { validateResizeViewport } from './viewport-bounds';

export type ResizeOutcome =
    | {
        ok: true;
        width: number;
        height: number;
        chromeWidth: number;
        chromeHeight: number;
        displayWidth: number;
        displayHeight: number;
    }
    | {
        ok: false;
        errorCode: string;
        phase: string;
        message: string;
        width: number;
        height: number;
    };

export type SessionViewportState = {
    width: number;
    height: number;
    device: DeviceProfile;
};

/**
 * Sole owner of the confirmed Motor viewport for a session.
 * Candidate sizes become confirmed only after display + Chrome verification.
 */
export class SessionViewport {
    private _width: number;
    private _height: number;
    private _device: DeviceProfile;
    private _resizing = false;

    constructor(width: number, height: number, device: DeviceProfile) {
        this._width = width;
        this._height = height;
        this._device = device;
    }

    get width(): number { return this._width; }
    get height(): number { return this._height; }
    get device(): DeviceProfile { return this._device; }
    get isResizing(): boolean { return this._resizing; }

    snapshot(): SessionViewportState {
        return { width: this._width, height: this._height, device: this._device };
    }

    /**
     * After Chrome launch on an exact Xvfb, verify display + CSS viewport match.
     * Throws on mismatch (fatal for session create).
     */
    async confirmInitial(
        display: VirtualDisplay,
        page: Page,
        width: number,
        height: number,
        device: DeviceProfile,
    ): Promise<void> {
        const active = await display.readActiveGeometry();
        if (active.width !== width || active.height !== height) {
            throw new Error(
                `display ${active.width}×${active.height} != requested ${width}×${height}`,
            );
        }
        const chrome = await readChromeViewport(page);
        if (chrome.width !== width || chrome.height !== height) {
            throw new Error(
                `chrome viewport ${chrome.width}×${chrome.height} != requested ${width}×${height}`,
            );
        }
        this._width = width;
        this._height = height;
        this._device = device;
    }

    /**
     * Apply a runtime resize. On size change the caller supplies recreate/relaunch
     * hooks (Xvfb cannot change modes via xrandr in this image).
     * On failure the confirmed state is left unchanged unless compensation fails.
     */
    async applyResize(args: {
        requestId: string;
        width: number;
        height: number;
        device: DeviceProfile;
        display: VirtualDisplay;
        page: Page;
        cdp: CDPSession;
        sameSizeOnly: (device: DeviceProfile) => Promise<void>;
        recreateAtSize: (width: number, height: number, device: DeviceProfile) => Promise<{
            display: VirtualDisplay;
            page: Page;
            cdp: CDPSession;
        }>;
    }): Promise<ResizeOutcome> {
        const validated = validateResizeViewport(args.width, args.height);
        if (!validated.ok) {
            return {
                ok: false,
                errorCode: validated.errorCode,
                phase: 'validate',
                message: validated.message,
                width: this._width,
                height: this._height,
            };
        }

        const nextW = validated.width;
        const nextH = validated.height;
        const sameSize = nextW === this._width && nextH === this._height;
        const sameDevice =
            this._device.mobile === args.device.mobile
            && this._device.touch === args.device.touch
            && this._device.deviceScaleFactor === args.device.deviceScaleFactor
            && this._device.maxTouchPoints === args.device.maxTouchPoints
            && this._device.userAgentProfile === args.device.userAgentProfile
            && this._device.screenOrientation === args.device.screenOrientation;

        if (sameSize && sameDevice) {
            return {
                ok: true,
                width: this._width,
                height: this._height,
                chromeWidth: this._width,
                chromeHeight: this._height,
                displayWidth: this._width,
                displayHeight: this._height,
            };
        }

        if (this._resizing) {
            return {
                ok: false,
                errorCode: 'resize_busy',
                phase: 'validate',
                message: 'another resize is in progress',
                width: this._width,
                height: this._height,
            };
        }

        this._resizing = true;
        const previous = this.snapshot();
        try {
            if (sameSize) {
                await args.sameSizeOnly(args.device);
                const chrome = await readChromeViewport(args.page);
                if (chrome.width !== this._width || chrome.height !== this._height) {
                    throw Object.assign(
                        new Error(`chrome viewport ${chrome.width}×${chrome.height} after device update`),
                        { phase: 'chrome_viewport' },
                    );
                }
                this._device = args.device;
                const active = await args.display.readActiveGeometry();
                return {
                    ok: true,
                    width: this._width,
                    height: this._height,
                    chromeWidth: chrome.width,
                    chromeHeight: chrome.height,
                    displayWidth: active.width,
                    displayHeight: active.height,
                };
            }

            const rebound = await args.recreateAtSize(nextW, nextH, args.device);
            const active = await rebound.display.readActiveGeometry();
            if (active.width !== nextW || active.height !== nextH) {
                throw Object.assign(
                    new Error(`display ${active.width}×${active.height} != ${nextW}×${nextH}`),
                    { phase: 'display_mode' },
                );
            }
            const chrome = await readChromeViewport(rebound.page);
            if (chrome.width !== nextW || chrome.height !== nextH) {
                throw Object.assign(
                    new Error(`chrome viewport ${chrome.width}×${chrome.height} != ${nextW}×${nextH}`),
                    { phase: 'chrome_viewport' },
                );
            }

            this._width = nextW;
            this._height = nextH;
            this._device = args.device;
            return {
                ok: true,
                width: nextW,
                height: nextH,
                chromeWidth: chrome.width,
                chromeHeight: chrome.height,
                displayWidth: active.width,
                displayHeight: active.height,
            };
        } catch (err) {
            const phase = (err as { phase?: string }).phase ?? 'resize_apply';
            const message = (err as Error).message ?? 'resize failed';
            // Confirmed dimensions stay at previous unless recreate already mutated ownership
            // (caller restores display/page bindings on failure).
            this._width = previous.width;
            this._height = previous.height;
            this._device = previous.device;
            return {
                ok: false,
                errorCode: 'resize_apply_failed',
                phase,
                message: message.slice(0, 512),
                width: previous.width,
                height: previous.height,
            };
        } finally {
            this._resizing = false;
        }
    }

    /** Apply device metrics for a same-size device-profile change. */
    async applyDeviceOnly(cdp: CDPSession, device: DeviceProfile): Promise<void> {
        await applyDeviceEmulation(cdp, this._width, this._height, device);
    }
}
