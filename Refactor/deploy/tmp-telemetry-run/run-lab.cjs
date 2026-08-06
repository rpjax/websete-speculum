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

  await page.goto(`${BASE}/w7s/lab`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(2500);

  const startBtn = page.getByRole("button", { name: /start/i }).first();
  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click();
  }

  await sleep(10000);
  const stopBtn = page.getByRole("button", { name: /^stop$/i }).first();
  const liveReady = await stopBtn.isVisible().catch(() => false);
  fs.writeFileSync(path.join(OUT, "lab-after-start.png"), await page.screenshot({ fullPage: true }));

  const observe = page.getByRole("button", { name: /observe/i }).first();
  if (await observe.isVisible().catch(() => false)) {
    await observe.click();
    await sleep(500);
  }

  let surface =
    (await page.locator("[data-speculum-dom-surface]").first().elementHandle().catch(() => null)) ||
    (await page.locator("canvas").first().elementHandle().catch(() => null));

  if (surface) {
    const box = await surface.boundingBox();
    if (box) {
      const cx = box.x + box.width * 0.5;
      const cy = box.y + box.height * 0.45;
      for (let i = 0; i < 10; i++) {
        await page.mouse.move(cx + i * 14, cy + (i % 2) * 10);
        await sleep(35);
      }
      await page.mouse.click(cx, cy);
      await sleep(250);
      await page.mouse.click(cx - 50, cy + 40);
      await sleep(250);
      await page.mouse.wheel(0, 500);
      await sleep(400);
      await page.mouse.wheel(0, -250);
      await sleep(400);
      await page.mouse.click(cx + 70, cy + 90);
      await sleep(400);
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy + 140, { steps: 12 });
      await page.mouse.up();
      await sleep(700);
      await page.keyboard.press("ArrowDown");
      await sleep(150);
      await page.keyboard.press("ArrowDown");
      await sleep(150);
      await page.keyboard.type("pipeline", { delay: 35 });
      await sleep(600);
    }
  }

  await sleep(3500);
  fs.writeFileSync(path.join(OUT, "lab-after-interact.png"), await page.screenshot({ fullPage: true }));
  fs.writeFileSync(path.join(OUT, "page-text.txt"), await page.locator("body").innerText());

  const exportBtn = page.getByRole("button", { name: /export jsonl/i }).first();
  if (await exportBtn.isVisible().catch(() => false)) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 5000 }).catch(() => null),
      exportBtn.click(),
    ]);
    if (download) await download.saveAs(path.join(OUT, "front-debug.jsonl"));
  }

  if (await stopBtn.isVisible().catch(() => false)) {
    await stopBtn.click();
    await sleep(2500);
  }

  fs.writeFileSync(path.join(OUT, "lab-after-stop.png"), await page.screenshot({ fullPage: true }));
  fs.writeFileSync(path.join(OUT, "browser-console.txt"), consoleLines.join("\n"));
  fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify({ base: BASE, liveReady, hasSurface: !!surface, at: new Date().toISOString() }, null, 2));
  await browser.close();
  console.log("DONE", JSON.stringify({ liveReady, hasSurface: !!surface }));
})().catch((err) => { console.error(err); process.exit(1); });