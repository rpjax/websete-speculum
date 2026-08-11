const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const OUT = String.raw`c:\RPJ\Coding\Projects\Seven\Websete\Websete Speculum\Refactor\deploy\tmp-telemetry-run`;
const BASE = "http://127.0.0.1:8080";
const PREFIX = process.env.PREFIX || "parityhop";
const WAIT_MS = Number(process.env.WAIT_MS || 75000);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  console.log("goto", BASE + "/");
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
  // Wait for session id
  let sessionId = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    sessionId = await page.evaluate(() => window.__speculumSessionId || null);
    if (sessionId) break;
    await page.waitForTimeout(500);
  }
  console.log("sessionId", sessionId, "armed wait...");
  // Wait for some surface / arm
  for (let i = 0; i < 60; i++) {
    const m = await page.evaluate(() => {
      const root = document.querySelector("[data-speculum-projected], #speculum-projected, .speculum-projected") || document.body;
      return {
        htmlLen: (root && root.innerHTML && root.innerHTML.length) || 0,
        sid: window.__speculumSessionId || null,
      };
    });
    if (m.sid) sessionId = m.sid;
    if (m.htmlLen > 20000) { console.log("surface htmlLen", m.htmlLen, "at", i); break; }
    await page.waitForTimeout(1000);
  }
  console.log("settle", WAIT_MS, "ms for Diff hops...");
  await page.waitForTimeout(WAIT_MS);
  // screenshot
  await page.screenshot({ path: path.join(OUT, `${PREFIX}-settled.png`), fullPage: false });
  // front activity
  const front = await page.evaluate(() => {
    if (typeof window.__speculumFrontDebugLog === "function") return window.__speculumFrontDebugLog();
    return [];
  });
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-front-activity.jsonl`),
    front.map((r) => JSON.stringify(r)).join("\n") + (front.length ? "\n" : ""),
  );
  sessionId = sessionId || (await page.evaluate(() => window.__speculumSessionId || null));
  if (!sessionId) {
    for (let i = front.length - 1; i >= 0; i--) {
      const sid = front[i]?.fields?.sessionId || front[i]?.sessionId;
      if (sid) { sessionId = sid; break; }
    }
  }
  console.log("export journal", sessionId, "frontRows", front.length);
  if (sessionId) {
    const res = await fetch(`${BASE}/w7s/api/sessions/${sessionId}/journal-export`);
    const body = await res.json();
    fs.writeFileSync(path.join(OUT, `${PREFIX}-journal-export.json`), JSON.stringify(body, null, 2));
    console.log("facts", (body.facts || []).length);
    // stop session
    await fetch(`${BASE}/w7s/api/sessions/${sessionId}/stop`, { method: "POST" }).catch(() => {});
  }
  fs.writeFileSync(path.join(OUT, `${PREFIX}-meta.json`), JSON.stringify({ sessionId, frontRows: front.length, waitedMs: WAIT_MS }, null, 2));
  await browser.close();
  console.log("DONE", sessionId);
})().catch((e) => { console.error(e); process.exit(1); });
