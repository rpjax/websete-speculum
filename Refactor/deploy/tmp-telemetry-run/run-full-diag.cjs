/**
 * COMPLETE Live diagnosis: cold paint → idle observe → interact → front JSONL + journal.
 * Usage: node run-full-diag.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const http = require("http");

const OUT = process.env.OUT_DIR || __dirname;
const BASE = process.env.BASE_URL || "http://127.0.0.1:8080";
const LIVE_URL = process.env.LIVE_URL || `${BASE}/`;
const PREFIX = "full";
const IDLE_MS = Number(process.env.IDLE_MS || 4000);
const INTERACT_SETTLE_MS = Number(process.env.INTERACT_SETTLE_MS || 3000);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getJson(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath.startsWith("http") ? urlPath : `${BASE}${urlPath}`);
    http
      .get(url, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode, body: JSON.parse(text) });
          } catch {
            resolve({ status: res.statusCode, body: text });
          }
        });
      })
      .on("error", reject);
  });
}

function parsePayload(f) {
  const p = f.payload ?? f.Payload;
  if (p == null) return {};
  if (typeof p === "object") return p;
  try {
    return JSON.parse(p);
  } catch {
    return {};
  }
}

function measureSurface(page) {
  return page
    .locator("[data-speculum-dom-surface]")
    .first()
    .evaluate((e) => {
      const owned = [...document.querySelectorAll("style[data-speculum-cssom-id]")];
      let ownedRules = 0;
      for (const st of owned) {
        try {
          ownedRules += st.sheet?.cssRules?.length || 0;
        } catch {
          /* ignore */
        }
      }
      let cssRuleApprox = 0;
      try {
        for (const sheet of document.styleSheets) {
          try {
            cssRuleApprox += sheet.cssRules?.length || 0;
          } catch {
            /* cors */
          }
        }
      } catch {
        cssRuleApprox = -1;
      }
      return {
        childCount: e.childElementCount,
        htmlLen: e.innerHTML.length,
        text: (e.innerText || "").slice(0, 800),
        cssRuleApprox,
        ownedSheets: owned.length,
        ownedRules,
      };
    })
    .catch((e) => ({ error: String(e) }));
}

(async () => {
  const since = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, `${PREFIX}-since.txt`), since);

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

  console.log("GOTO", LIVE_URL);
  await page.goto(LIVE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  let surface = null;
  let sessionId = null;
  for (let i = 0; i < 60; i++) {
    surface = await measureSurface(page);
    sessionId = await page
      .evaluate(() => {
        if (window.__speculumSessionId) return window.__speculumSessionId;
        const m = location.href.match(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
        );
        return m ? m[0] : null;
      })
      .catch(() => null);
    const errOverlay = await page
      .getByText(/isn.?t available right now|failed to start|session ended/i)
      .isVisible()
      .catch(() => false);
    if (errOverlay) break;
    if (
      surface &&
      !surface.error &&
      surface.childCount > 0 &&
      surface.htmlLen > 800 &&
      (surface.ownedRules > 10 || surface.ownedSheets > 0 || surface.cssRuleApprox > 100)
    ) {
      break;
    }
    await sleep(400);
  }

  fs.writeFileSync(path.join(OUT, `${PREFIX}-after-start.png`), await page.screenshot({ fullPage: false }));
  console.log("COLD", JSON.stringify(surface));
  console.log("SESSION", sessionId);

  // Phase A: idle — no inputs — let live diffs + optional first desync settle
  console.log("IDLE", IDLE_MS, "ms");
  await sleep(IDLE_MS);
  console.log("IDLE done, measuring…");
  const surfaceIdle = await measureSurface(page);
  const frontIdleCount = await page
    .evaluate(() =>
      typeof window.__speculumFrontDebugLog === "function"
        ? window.__speculumFrontDebugLog().length
        : -1,
    )
    .catch(() => -1);
  fs.writeFileSync(path.join(OUT, `${PREFIX}-after-idle.png`), await page.screenshot({ fullPage: false }));
  console.log("IDLE_FRONT", frontIdleCount, "SURFACE", JSON.stringify(surfaceIdle));

  // Phase B: interact
  const box = await page.locator("[data-speculum-dom-surface]").first().boundingBox().catch(() => null);
  if (box) {
    const cx = box.x + Math.min(box.width * 0.45, 500);
    const cy = box.y + Math.min(box.height * 0.35, 280);
    await page.mouse.move(cx, cy);
    await sleep(80);
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx + i * 14, cy + (i % 2) * 8);
      await sleep(35);
    }
    await page.mouse.click(cx, cy, { button: "left" });
    await sleep(500);
    await page.mouse.wheel(0, 600);
    await sleep(600);
    await page.mouse.wheel(0, -250);
    await sleep(400);
    // Soft-nav probe: focus search-like input, type query, Enter (same-document SPA).
    const search = page
      .locator("[data-speculum-dom-surface] input[type='search'], [data-speculum-dom-surface] input[placeholder*='earch' i], [data-speculum-dom-surface] input[name*='earch' i]")
      .first();
    if (await search.count().catch(() => 0)) {
      await search.click({ timeout: 3000 }).catch(() => {});
      await sleep(200);
      await page.keyboard.type("fulldiag", { delay: 40 });
      await sleep(400);
      await page.keyboard.press("Enter");
      await sleep(2500);
    } else {
      await page.keyboard.type("fulldiag", { delay: 40 });
      await sleep(700);
      await page.keyboard.press("Enter");
      await sleep(1500);
    }
    const steam = page
      .locator("[data-speculum-dom-surface] a")
      .filter({ hasText: /steam|play|buy|game/i })
      .first();
    if (await steam.count().catch(() => 0)) {
      await steam.click({ timeout: 3000 }).catch(() => {});
      await sleep(1500);
    } else {
      await page.mouse.click(cx + 120, cy + 80, { button: "left" });
      await sleep(800);
    }
  }

  console.log("INTERACT settle", INTERACT_SETTLE_MS);
  await sleep(INTERACT_SETTLE_MS);
  const surfaceAfter = await measureSurface(page);
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-after-interact.png`),
    await page.screenshot({ fullPage: false }),
  );

  // Capture front ring BEFORE leaving Live (hooks die on navigation)
  console.log("EXPORT front ring…");
  const frontExport = await page
    .evaluate(() => {
      const hasExport = typeof window.__speculumExportFrontDebugJsonl === "function";
      const hasLog = typeof window.__speculumFrontDebugLog === "function";
      const rows = hasLog ? window.__speculumFrontDebugLog() : [];
      // Prefer structured rows; build jsonl in Node to avoid huge evaluate string churn.
      return {
        hasExport,
        hasLog,
        sessionId: window.__speculumSessionId || null,
        count: Array.isArray(rows) ? rows.length : 0,
        rows: Array.isArray(rows) ? rows : [],
        sampleLabels: Array.isArray(rows)
          ? rows.slice(0, 8).map((r) => `${r.level}:${r.label}`)
          : [],
      };
    })
    .catch((e) => ({ error: String(e) }));

  if (frontExport?.rows?.length) {
    const jsonl = frontExport.rows.map((r) => JSON.stringify(r)).join("\n");
    fs.writeFileSync(path.join(OUT, `${PREFIX}-front-activity.jsonl`), jsonl);
    fs.writeFileSync(
      path.join(OUT, `${PREFIX}-front-activity.json`),
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          sessionId: frontExport.sessionId || sessionId,
          count: frontExport.rows.length,
          activity: frontExport.rows,
        },
        null,
        2,
      ),
    );
  }
  // Compat for exit check
  frontExport.hasExport = Boolean(frontExport?.hasExport || frontExport?.hasLog);
  frontExport.jsonl = frontExport?.rows?.length ? "ok" : null;

  sessionId = frontExport?.sessionId || sessionId;
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-browser-console.txt`),
    consoleLines.join("\n"),
  );
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-net-fails.json`),
    JSON.stringify({ liveUrl: LIVE_URL, fails, surface, surfaceIdle, surfaceAfter, sessionId }, null, 2),
  );
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-page-text.txt`),
    await page.locator("body").innerText().catch(() => ""),
  );

  console.log("FRONT", JSON.stringify({
    hasExport: frontExport?.hasExport,
    hasLog: frontExport?.hasLog,
    count: frontExport?.count,
    sample: frontExport?.sampleLabels,
  }));

  // Detach
  console.log("DETACH -> /w7s/lab");
  await page.goto(`${BASE}/w7s/lab`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await sleep(3000);
  fs.writeFileSync(path.join(OUT, `${PREFIX}-after-stop.png`), await page.screenshot({ fullPage: false }));
  await browser.close();

  if (!sessionId) {
    const listed = await getJson("/w7s/api/sessions?take=10");
    const items = Array.isArray(listed.body)
      ? listed.body
      : listed.body?.items || listed.body?.sessions || [];
    const live = items.find((s) => String(s.state).toLowerCase() === "live");
    sessionId = live?.sessionId || items[0]?.sessionId || null;
  }

  let journal = null;
  if (sessionId) {
    console.log("EXPORT journal", sessionId);
    const exp = await getJson(`/w7s/api/sessions/${sessionId}/journal-export`);
    journal = exp.body;
    fs.writeFileSync(
      path.join(OUT, `${PREFIX}-journal-export.json`),
      JSON.stringify(journal, null, 2),
    );
    const sess = await getJson(`/w7s/api/sessions/${sessionId}`);
    fs.writeFileSync(path.join(OUT, `${PREFIX}-session.json`), JSON.stringify(sess.body, null, 2));
  }

  // Global journal since watermark (all Telemetry in window)
  const allJournal = await getJson(
    `/w7s/api/journal?take=8000&since=${encodeURIComponent(since)}`,
  ).catch(() => null);
  if (allJournal?.body) {
    fs.writeFileSync(
      path.join(OUT, `${PREFIX}-journal-since.json`),
      JSON.stringify(allJournal.body, null, 2),
    );
  }

  const facts = journal?.facts || [];
  const byType = {};
  for (const f of facts) {
    const t = f.type || f.Type || "unknown";
    byType[t] = (byType[t] || 0) + 1;
  }

  const summary = {
    since,
    sessionId,
    surface,
    surfaceIdle,
    surfaceAfter,
    failCount: fails.length,
    fails: fails.slice(0, 40),
    consoleErrors: consoleLines.filter((l) => /\[error\]|\[pageerror\]/i.test(l)).length,
    factCount: facts.length,
    byType: Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1])),
    front: {
      hasExport: Boolean(frontExport?.hasExport),
      hasLog: Boolean(frontExport?.hasLog),
      count: frontExport?.count ?? 0,
      sampleLabels: frontExport?.sampleLabels ?? [],
      error: frontExport?.error,
    },
  };
  fs.writeFileSync(path.join(OUT, `${PREFIX}-summary.json`), JSON.stringify(summary, null, 2));
  console.log("DONE", JSON.stringify(summary, null, 2));

  if (!summary.front.hasExport || summary.front.count < 1) {
    console.error("FRONT_TELEMETRY_MISSING");
    process.exit(3);
  }
  if (!sessionId || facts.length < 1) {
    console.error("JOURNAL_TELEMETRY_MISSING");
    process.exit(4);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
