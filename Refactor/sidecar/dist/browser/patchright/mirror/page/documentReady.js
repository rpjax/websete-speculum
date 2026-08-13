"use strict";
/**
 * §5.6 / K4 — generic Virtual document settle before establish.
 * Navigation / URL / main-frame framenavigated resets clocks; evaluate failures
 * continue the wait (never treat a throw as ready). Watch-after catches late
 * interstitial → real document replacement.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitVirtualDocumentReady = waitVirtualDocumentReady;
const HTML_LEN_SNIPPET = `(() => document.documentElement?.outerHTML?.length ?? 0)()`;
const FINGERPRINT_SNIPPET = `(() => {
  const b = document.body;
  if (!b) return '';
  // Bucket volatile signals — carousels/ads mutate text and child lists
  // continuously and must not block establish forever. readyState + coarse
  // size/structure is enough for §5.6 settle (Beleza-scale SPAs).
  const htmlLen = document.documentElement?.outerHTML?.length ?? 0;
  return [
    document.readyState,
    String(Math.floor(b.childElementCount / 32)),
    String(Math.floor(htmlLen / 8192)),
  ].join('|');
})()`;
async function waitVirtualDocumentReady(opts) {
    const timeoutMs = opts.timeoutMs ?? 90_000;
    const growthQuietMs = opts.growthQuietMs ?? 2_000;
    const fingerprintQuietMs = opts.fingerprintQuietMs ?? 1_500;
    const watchAfterQuietMs = opts.watchAfterQuietMs ?? 2_000;
    const { page } = opts;
    const t0 = Date.now();
    let navBump = 0;
    const onFrameNavigated = (frame) => {
        if (frame.parentFrame() == null)
            navBump += 1;
    };
    page.on('framenavigated', onFrameNavigated);
    let maxLen = 0;
    let lastGrowthAt = Date.now();
    let lastFp = '';
    let stableSince = 0;
    let quietFp = '';
    let watchUntil = 0;
    let seenUrl = page.url();
    let seenEpoch = opts.getDocumentEpoch();
    let lastNavBump = navBump;
    const resetClocks = () => {
        maxLen = 0;
        lastGrowthAt = Date.now();
        lastFp = '';
        stableSince = 0;
        quietFp = '';
        watchUntil = 0;
    };
    const navigationChanged = () => {
        const url = page.url();
        const epoch = opts.getDocumentEpoch();
        const bumped = navBump !== lastNavBump;
        if (!bumped && url === seenUrl && epoch === seenEpoch)
            return false;
        lastNavBump = navBump;
        seenUrl = url;
        seenEpoch = epoch;
        resetClocks();
        return true;
    };
    try {
        while (!opts.isStopped() && Date.now() - t0 < timeoutMs) {
            if (navigationChanged()) {
                await new Promise((r) => setTimeout(r, 200));
                continue;
            }
            let len = 0;
            try {
                len = Number(await page.evaluate(HTML_LEN_SNIPPET)) || 0;
            }
            catch {
                await new Promise((r) => setTimeout(r, 200));
                continue;
            }
            if (len > maxLen + 256) {
                maxLen = len;
                lastGrowthAt = Date.now();
            }
            // Bot walls / soft interstitials often sit complete+quiet at a tiny HTML
            // size before the real document replaces them. Keep waiting for growth
            // while title still looks like a challenge page (generic, not host-specific).
            if (maxLen > 0 && Date.now() - lastGrowthAt >= growthQuietMs) {
                let title = '';
                try {
                    title = String((await page.evaluate(`document.title || ''`)) ?? '');
                }
                catch {
                    title = '';
                }
                const botWall = maxLen < 64 * 1024
                    && /access denied|attention required|just a moment|verify you are|um momento|acesso negado/i.test(title);
                if (!botWall || Date.now() - t0 >= timeoutMs - 3_000)
                    break;
                lastGrowthAt = Date.now();
            }
            await new Promise((r) => setTimeout(r, 200));
        }
        while (!opts.isStopped() && Date.now() - t0 < timeoutMs) {
            if (navigationChanged()) {
                await new Promise((r) => setTimeout(r, 200));
                continue;
            }
            let fp = '';
            try {
                fp = String((await page.evaluate(FINGERPRINT_SNIPPET)) ?? '');
            }
            catch {
                await new Promise((r) => setTimeout(r, 200));
                continue;
            }
            if (watchUntil > 0) {
                if (fp && quietFp && fp !== quietFp) {
                    lastFp = fp;
                    stableSince = 0;
                    quietFp = '';
                    watchUntil = 0;
                    continue;
                }
                if (Date.now() >= watchUntil)
                    return;
                await new Promise((r) => setTimeout(r, 200));
                continue;
            }
            if (fp && fp === lastFp) {
                if (!stableSince)
                    stableSince = Date.now();
                if (Date.now() - stableSince >= fingerprintQuietMs) {
                    quietFp = fp;
                    watchUntil = Date.now() + watchAfterQuietMs;
                    continue;
                }
            }
            else {
                lastFp = fp;
                stableSince = 0;
            }
            await new Promise((r) => setTimeout(r, 200));
        }
    }
    finally {
        page.off('framenavigated', onFrameNavigated);
    }
}
//# sourceMappingURL=documentReady.js.map