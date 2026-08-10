const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = process.env.OUT_DIR || __dirname;
const BASE = process.env.BASE_URL || "http://127.0.0.1:8080";
/** Immersive live catch-all — not /w7s/lab. Path becomes StartSession navigation. */
const LIVE_URL = process.env.LIVE_URL || `${BASE}/`;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const consoleLines = [];
  const fails = [];
  page.on("console", (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => consoleLines.push(`[pageerror] ${err.message}`));
  page.on("response", (res) => {
    if (res.status() >= 400) fails.push({ status: res.status(), url: res.url() });
  });

  await page.goto(LIVE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(2000);

  // Live auto-starts; wait for Dom surface content or error chrome.
  let surface = null;
  for (let i = 0; i < 40; i++) {
    surface = await page
      .locator("[data-speculum-dom-surface]")
      .first()
      .evaluate((e) => ({
        childCount: e.childElementCount,
        htmlLen: e.innerHTML.length,
        text: (e.innerText || "").slice(0, 500),
      }))
      .catch(() => null);
    const errOverlay = await page
      .getByText(/isn.?t available right now/i)
      .isVisible()
      .catch(() => false);
    if (errOverlay) break;
    if (surface && surface.childCount > 0 && surface.htmlLen > 500) break;
    await sleep(500);
  }

  fs.writeFileSync(path.join(OUT, "live-after-start.png"), await page.screenshot({ fullPage: true }));

  const box = await page.locator("[data-speculum-dom-surface]").first().boundingBox().catch(() => null);
  if (box) {
    const cx = box.x + box.width * 0.5;
    const cy = box.y + box.height * 0.4;
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(cx + i * 10, cy + (i % 2) * 6);
      await sleep(40);
    }
    await page.mouse.click(cx, cy, { button: "left" });
    await sleep(400);
    await page.mouse.wheel(0, 500);
    await sleep(500);
    await page.mouse.wheel(0, -200);
    await sleep(400);
    await page.keyboard.press("ArrowDown");
    await sleep(200);
    await page.keyboard.type("live-smoke", { delay: 35 });
    await sleep(800);
  }

  await sleep(2500);
  fs.writeFileSync(path.join(OUT, "live-after-interact.png"), await page.screenshot({ fullPage: true }));

  const surfaceAfter = await page
    .locator("[data-speculum-dom-surface]")
    .first()
    .evaluate((e) => ({
      childCount: e.childElementCount,
      htmlLen: e.innerHTML.length,
      text: (e.innerText || "").slice(0, 800),
    }))
    .catch((e) => ({ error: String(e) }));

  const bodyText = await page.locator("body").innerText().catch(() => "");
  fs.writeFileSync(path.join(OUT, "live-page-text.txt"), bodyText);
  fs.writeFileSync(path.join(OUT, "live-browser-console.txt"), consoleLines.join("\n"));
  fs.writeFileSync(
    path.join(OUT, "live-net-fails.json"),
    JSON.stringify({ liveUrl: LIVE_URL, fails, surface, surfaceAfter }, null, 2),
  );
  fs.writeFileSync(
    path.join(OUT, "live-meta.json"),
    JSON.stringify(
      {
        base: BASE,
        liveUrl: LIVE_URL,
        at: new Date().toISOString(),
        surface,
        surfaceAfter,
        failCount: fails.length,
        consoleErrors: consoleLines.filter((l) => /\[error\]|\[pageerror\]/i.test(l)).length,
      },
      null,
      2,
    ),
  );

  // Leave session running briefly so journal has facts; then reload away to detach.
  await page.goto(`${BASE}/w7s/lab`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await sleep(2500);

  await browser.close();
  console.log(
    "DONE",
    JSON.stringify({
      liveUrl: LIVE_URL,
      childCount: surfaceAfter?.childCount ?? surface?.childCount ?? 0,
      htmlLen: surfaceAfter?.htmlLen ?? surface?.htmlLen ?? 0,
      failCount: fails.length,
      fails: fails.slice(0, 15),
    }),
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
