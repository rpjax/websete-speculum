const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = process.env.OUT_DIR;
const BASE = process.env.BASE_URL || "http://127.0.0.1:8080";

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const consoleLines = [];
  page.on("console", (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => consoleLines.push(`[pageerror] ${err.message}`));

  // Prefer Lab for Start/Stop + Activity; same DomProjection pipeline as Live.
  await page.goto(`${BASE}/w7s/lab`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(2000);

  // Start session if button present
  const startBtn = page.getByRole("button", { name: /start/i }).first();
  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click();
  }

  // Wait until live-ish UI (Stop or surface)
  await page.waitForTimeout(8000);
  const stopBtn = page.getByRole("button", { name: /^stop$/i }).first();
  const liveReady = await stopBtn.isVisible().catch(() => false);
  fs.writeFileSync(path.join(OUT, "lab-after-start.png"), await page.screenshot({ fullPage: true }));

  // Try to open Observe chrome on Live float if present; Lab Activity is in debug dock
  const observe = page.getByRole("button", { name: /observe/i }).first();
  if (await observe.isVisible().catch(() => false)) {
    await observe.click();
    await sleep(500);
  }

  // Interact with projected/video surface
  const surface =
    (await page.locator("[data-speculum-dom-surface]").first().elementHandle().catch(() => null)) ||
    (await page.locator("canvas").first().elementHandle().catch(() => null)) ||
    (await page.locator("[data-speculum-canvas], .relative").first().elementHandle().catch(() => null));

  if (surface) {
    const box = await surface.boundingBox();
    if (box) {
      const cx = box.x + box.width * 0.5;
      const cy = box.y + box.height * 0.45;
      for (let i = 0; i < 8; i++) {
        await page.mouse.move(cx + i * 12, cy + (i % 2) * 8);
        await sleep(40);
      }
      await page.mouse.click(cx, cy, { button: "left" });
      await sleep(300);
      await page.mouse.click(cx - 40, cy + 30, { button: "left" });
      await sleep(300);
      await page.mouse.wheel(0, 400);
      await sleep(400);
      await page.mouse.wheel(0, -200);
      await sleep(400);
      await page.mouse.click(cx + 60, cy + 80, { button: "left" });
      await sleep(500);
      // drag scroll-ish
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy + 120, { steps: 10 });
      await page.mouse.up();
      await sleep(800);
      // keyboard
      await page.keyboard.press("ArrowDown");
      await sleep(200);
      await page.keyboard.press("ArrowDown");
      await sleep(200);
      await page.keyboard.type("test", { delay: 40 });
      await sleep(500);
    }
  }

  await sleep(3000);
  fs.writeFileSync(path.join(OUT, "lab-after-interact.png"), await page.screenshot({ fullPage: true }));

  // Capture Activity/Observe text
  const bodyText = await page.locator("body").innerText();
  fs.writeFileSync(path.join(OUT, "page-text.txt"), bodyText);

  // Try Export JSONL if button exists (download)
  const exportBtn = page.getByRole("button", { name: /export jsonl/i }).first();
  if (await exportBtn.isVisible().catch(() => false)) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 5000 }).catch(() => null),
      exportBtn.click(),
    ]);
    if (download) {
      await download.saveAs(path.join(OUT, "front-debug.jsonl"));
    }
  }

  // Stop session
  if (await stopBtn.isVisible().catch(() => false)) {
    await stopBtn.click();
    await sleep(2500);
  }

  fs.writeFileSync(path.join(OUT, "lab-after-stop.png"), await page.screenshot({ fullPage: true }));
  fs.writeFileSync(path.join(OUT, "browser-console.txt"), consoleLines.join("\n"));
  fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify({
    base: BASE,
    liveReady,
    hasSurface: !!surface,
    at: new Date().toISOString(),
  }, null, 2));

  await browser.close();
  console.log("DONE", JSON.stringify({ liveReady, hasSurface: !!surface }));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});