import { Page } from 'patchright';
import { encodeFullFrame } from './Protocol';

/**
 * Captures frames from the browser page and relays them to the caller.
 *
 * ── Why not CDP Page.startScreencast? ────────────────────────────────────────
 * startScreencast uses a request-ACK mechanism: Chrome will not render and
 * send frame N+1 until we send Page.screencastFrameAck for frame N. Even with
 * an immediate fire-and-forget ACK, this creates a sequentialised round-trip
 * per frame. In practice, this caps throughput at ~25–30 fps.
 *
 * ── Approach: continuous page.screenshot() loop ───────────────────────────────
 * page.screenshot() fires a direct CDP Page.captureScreenshot request and
 * returns as soon as Chrome responds — no ACK protocol, no back-pressure from
 * Chrome's side. Each call takes ~10–20 ms depending on page complexity, which
 * gives us 50–100 fps headroom before the loop itself becomes the bottleneck.
 *
 * ── Adaptive rate ─────────────────────────────────────────────────────────────
 * Screenshotting at 60 fps on a static page wastes CPU. We detect unchanged
 * frames (hash of first+last 16 JPEG bytes) and progressively throttle:
 *
 *   0 – 30 identical frames  → 60 fps  (page might be mid-animation)
 *   30 – 150 identical frames → 15 fps  (page is mostly idle)
 *   150+  identical frames    →  3 fps  (page is completely static)
 *
 * Any detected change resets the counter and resumes 60 fps immediately.
 *
 * ── Frame dropping ────────────────────────────────────────────────────────────
 * Skipped frames (identical hash) are silently discarded — the caller's
 * onFrame is not invoked. This avoids sending 1-byte skip messages across the
 * WebSocket for every quiet frame.
 */

const TARGET_FPS     = 60;
const TARGET_MS      = 1000 / TARGET_FPS;  // 16.67 ms per frame at 60 fps
const JPEG_QUALITY   = 80;

// Consecutive-skip thresholds for throttling
const THROTTLE_MODERATE = 30;   // → 15 fps
const THROTTLE_IDLE     = 150;  // →  3 fps

const FPS_MODERATE = 15;
const FPS_IDLE     = 3;

export class Screencast {
    private _stopped = false;
    private _frameId = 0;

    private constructor() {}

    static async start(
        page:    Page,
        width:   number,
        height:  number,
        onFrame: (buf: Buffer) => void,
    ): Promise<Screencast> {
        const sc = new Screencast();
        // Fire the capture loop in the background — do not await.
        sc._run(page, onFrame).catch(err => {
            if (!sc._stopped) {
                console.error('[Screencast] fatal loop error:', (err as Error).message);
            }
        });
        return sc;
    }

    private async _run(page: Page, onFrame: (buf: Buffer) => void): Promise<void> {
        let prevHash         = '';
        let consecutiveSkips = 0;

        while (!this._stopped) {
            const t0 = Date.now();

            // ── Capture ───────────────────────────────────────────────────────
            let jpeg: Buffer;
            try {
                jpeg = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY });
            } catch (err) {
                if (this._stopped) break;
                console.error('[Screencast] screenshot error:', (err as Error).message);
                await sleep(200);
                continue;
            }

            if (this._stopped) break;

            // ── Identity check ────────────────────────────────────────────────
            // Compare the first 16 and last 16 bytes of the JPEG stream.
            // Chrome's encoder produces identical byte sequences for identical
            // frames, so this is both cheap and reliable.
            const hash =
                jpeg.subarray(0, 16).toString('hex') +
                jpeg.subarray(-16).toString('hex');

            if (hash === prevHash) {
                // Frame is identical — don't emit, just throttle.
                consecutiveSkips++;
            } else {
                // Frame changed — emit and reset throttle counter.
                prevHash         = hash;
                consecutiveSkips = 0;
                onFrame(encodeFullFrame(++this._frameId, jpeg));
            }

            // ── Adaptive rate control ─────────────────────────────────────────
            const elapsed     = Date.now() - t0;
            const targetMs    = targetFrameMs(consecutiveSkips);
            const remaining   = targetMs - elapsed;
            if (remaining > 0) await sleep(remaining);
        }
    }

    async stop(): Promise<void> {
        this._stopped = true;
    }
}

/** Returns the target inter-frame interval based on how long the page has been static. */
function targetFrameMs(skips: number): number {
    if (skips >= THROTTLE_IDLE)     return 1000 / FPS_IDLE;
    if (skips >= THROTTLE_MODERATE) return 1000 / FPS_MODERATE;
    return TARGET_MS;
}

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}
