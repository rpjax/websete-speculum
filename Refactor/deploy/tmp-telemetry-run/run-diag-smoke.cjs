/**
 * Short Live smoke + telemetry harvest for diagnosis (no product fixes).
 * Usage: node run-diag-smoke.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const http = require("http");

const OUT = process.env.OUT_DIR || __dirname;
const BASE = process.env.BASE_URL || "http://127.0.0.1:8080";
const LIVE_URL = process.env.LIVE_URL || `${BASE}/`;
const PREFIX = "diag";

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

  // Live auto-starts; wait for Dom surface + Cssom paint (not just empty DOM).
  let surface = null;
  let sessionId = null;
  for (let i = 0; i < 60; i++) {
    surface = await page
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
          text: (e.innerText || "").slice(0, 600),
          cssRuleApprox,
          ownedSheets: owned.length,
          ownedRules,
        };
      })
      .catch(() => null);

    sessionId = await page
      .evaluate(() => {
        const m = location.href.match(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
        );
        if (m) return m[0];
        const el = document.querySelector("[data-session-id]");
        if (el?.getAttribute("data-session-id")) return el.getAttribute("data-session-id");
        return window.__speculumSessionId || null;
      })
      .catch(() => null);

    const errOverlay = await page
      .getByText(/isn.?t available right now|failed to start|session ended/i)
      .isVisible()
      .catch(() => false);
    if (errOverlay) break;
    // Prefer styled surface: owned Cssom rules or substantial html + owned sheets.
    if (
      surface &&
      surface.childCount > 0 &&
      surface.htmlLen > 800 &&
      (surface.ownedRules > 10 || surface.ownedSheets > 0 || surface.cssRuleApprox > 100)
    ) {
      break;
    }
    await sleep(400);
  }

  // Resolve sessionId from API if still unknown (newest Live)
  if (!sessionId) {
    const listed = await getJson("/w7s/api/sessions?take=10");
    const items = Array.isArray(listed.body)
      ? listed.body
      : listed.body?.items || listed.body?.sessions || [];
    const live = items.find((s) => String(s.state).toLowerCase() === "live");
    sessionId = live?.sessionId || items[0]?.sessionId || null;
  }

  await page.screenshot({ path: path.join(OUT, `${PREFIX}-after-start.png`), fullPage: true });
  console.log("SURFACE", JSON.stringify(surface));
  console.log("SESSION", sessionId);

  const box = await page.locator("[data-speculum-dom-surface]").first().boundingBox().catch(() => null);
  if (box) {
    const cx = box.x + Math.min(box.width * 0.45, 500);
    const cy = box.y + Math.min(box.height * 0.35, 280);
    // hover + click center-ish
    await page.mouse.move(cx, cy);
    await sleep(80);
    await page.mouse.click(cx, cy, { button: "left" });
    await sleep(500);
    // scroll
    await page.mouse.wheel(0, 600);
    await sleep(600);
    await page.mouse.wheel(0, -250);
    await sleep(400);
    // type a short query-ish string (may hit search if focused)
    await page.keyboard.type("diag", { delay: 40 });
    await sleep(700);
    // try Steam / product link inside surface if present
    const steam = page.locator("[data-speculum-dom-surface] a").filter({ hasText: /steam|play|buy|game/i }).first();
    if (await steam.count().catch(() => 0)) {
      await steam.click({ timeout: 3000 }).catch(() => {});
      await sleep(1500);
    } else {
      // second click elsewhere
      await page.mouse.click(cx + 120, cy + 80, { button: "left" });
      await sleep(800);
    }
  }

  await sleep(2000);
  await page.screenshot({ path: path.join(OUT, `${PREFIX}-after-interact.png`), fullPage: true });

  const surfaceAfter = await page
    .locator("[data-speculum-dom-surface]")
    .first()
    .evaluate((e) => ({
      childCount: e.childElementCount,
      htmlLen: e.innerHTML.length,
      text: (e.innerText || "").slice(0, 900),
      ownedSheets: (() => {
        const owned = [...document.querySelectorAll("style[data-speculum-sheet]")];
        let rules = 0;
        for (const st of owned) {
          const sheet = st.sheet;
          try {
            rules += sheet?.cssRules?.length || 0;
          } catch {
            /* ignore */
          }
        }
        return { count: owned.length, rules };
      })(),
    }))
    .catch((e) => ({ error: String(e) }));

  // Best-effort front Activity ring if Lab-style export is on window
  const frontJsonl = await page
    .evaluate(() => {
      if (typeof window.__speculumExportFrontDebugJsonl === "function") {
        return window.__speculumExportFrontDebugJsonl();
      }
      if (Array.isArray(window.__speculumFrontDebugLog)) {
        return window.__speculumFrontDebugLog.map((e) => JSON.stringify(e)).join("\n");
      }
      return null;
    })
    .catch(() => null);
  if (frontJsonl) {
    fs.writeFileSync(path.join(OUT, `${PREFIX}-front-activity.jsonl`), frontJsonl);
  }

  fs.writeFileSync(path.join(OUT, `${PREFIX}-page-text.txt`), await page.locator("body").innerText().catch(() => ""));
  fs.writeFileSync(path.join(OUT, `${PREFIX}-browser-console.txt`), consoleLines.join("\n"));
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-net-fails.json`),
    JSON.stringify({ liveUrl: LIVE_URL, fails, surface, surfaceAfter, sessionId }, null, 2),
  );

  // Close / detach session
  console.log("DETACH -> /w7s/lab");
  await page.goto(`${BASE}/w7s/lab`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await sleep(3000);
  await page.screenshot({ path: path.join(OUT, `${PREFIX}-after-stop.png`), fullPage: true });
  await browser.close();

  // Re-resolve session if needed
  if (!sessionId) {
    const listed = await getJson("/w7s/api/sessions?take=5");
    const items = Array.isArray(listed.body)
      ? listed.body
      : listed.body?.items || listed.body?.sessions || [];
    sessionId = items[0]?.sessionId || null;
  }

  let journal = null;
  if (sessionId) {
    console.log("EXPORT journal", sessionId);
    const exp = await getJson(`/w7s/api/sessions/${sessionId}/journal-export`);
    journal = exp.body;
    fs.writeFileSync(path.join(OUT, `${PREFIX}-journal-export.json`), JSON.stringify(journal, null, 2));

    // Also dump recent journal facts since timestamp (global filter by type Telemetry)
    const all = await getJson(
      `/w7s/api/journal?take=5000&since=${encodeURIComponent(since)}`.replace(
        "/w7s/api/journal",
        "/w7s/api/journal",
      ),
    ).catch(() => null);
    // Prefer sessions list detail
    const sess = await getJson(`/w7s/api/sessions/${sessionId}`);
    fs.writeFileSync(path.join(OUT, `${PREFIX}-session.json`), JSON.stringify(sess.body, null, 2));
  }

  const facts = journal?.facts || [];
  const byType = {};
  for (const f of facts) {
    const t = f.type || f.Type || "unknown";
    byType[t] = (byType[t] || 0) + 1;
  }
  const pp = Object.entries(byType)
    .filter(([k]) => /PageProjection|Client\.|Session\.|Telemetry/i.test(k))
    .sort((a, b) => b[1] - a[1]);

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

  const frameFacts = facts
    .filter((f) => /PageProjection\.Diff\.FrameReceived$/i.test(f.type || f.Type || ""))
    .map((f) => ({ at: f.publishedAt, ...parsePayload(f) }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const wireFacts = facts
    .filter((f) => /PageProjection\.Diff\.WireDelivered$/i.test(f.type || f.Type || ""))
    .map((f) => ({ at: f.publishedAt, ...parsePayload(f) }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const resyncReq = facts
    .filter((f) => /PageProjection\.Diff\.ResyncRequested$/i.test(f.type || f.Type || ""))
    .map((f) => parsePayload(f));
  const resyncSrv = facts
    .filter((f) => /PageProjection\.Diff\.ResyncServed$/i.test(f.type || f.Type || ""))
    .map((f) => parsePayload(f));
  const genBumps = facts.filter((f) =>
    /PageProjection\.Diff\.GenerationBumped$/i.test(f.type || f.Type || ""),
  ).length;

  const firstTwoFr = frameFacts.slice(0, 2).map((f) => `${f.plane}/${f.operation}@seq${f.sequence}`);
  const firstTwoWd = wireFacts.slice(0, 2).map((f) => `${f.plane}/${f.operation}@seq${f.sequence}`);
  const bootOpsOk = (ops) =>
    ops.length >= 2 &&
    ops[0].endsWith("/document@seq1") &&
    ops[1].startsWith("cssom/install@seq");
  const gen0ResyncReq = resyncReq.filter(
    (p) => Number(p.hintGeneration ?? p.HintGeneration) === 0 && Number(p.hintSequence ?? p.HintSequence) === 0,
  );
  const covers0Served = resyncSrv.filter(
    (p) => Number(p.coversThroughSequence ?? p.CoversThroughSequence) === 0,
  );
  const ownedRules =
    Number(surface?.ownedRules) ||
    Number(surfaceAfter?.ownedSheets?.rules) ||
    0;
  const ownedSheets =
    Number(surface?.ownedSheets) ||
    Number(surfaceAfter?.ownedSheets?.count) ||
    0;

  const t10 = {
    firstFrameOps: firstTwoFr,
    firstWireOps: firstTwoWd,
    frameBootDocumentThenInstall: bootOpsOk(frameFacts.map((f) => `${f.plane}/${f.operation}@seq${f.sequence}`).slice(0, 2)),
    wireBootDocumentThenInstall: bootOpsOk(wireFacts.map((f) => `${f.plane}/${f.operation}@seq${f.sequence}`).slice(0, 2)),
    noGen0Seq0ResyncRequested: gen0ResyncReq.length === 0,
    noCoversThroughSequence0: covers0Served.length === 0,
    generationBumpedCount: genBumps,
    resyncRequestedCount: resyncReq.length,
    resyncServedCount: resyncSrv.length,
    coldPaintOwnedSheets: ownedSheets,
    coldPaintOwnedRules: ownedRules,
    coldPaintCssomOk: ownedSheets >= 1 && ownedRules > 10,
  };
  t10.pass =
    t10.frameBootDocumentThenInstall &&
    t10.wireBootDocumentThenInstall &&
    t10.noGen0Seq0ResyncRequested &&
    t10.noCoversThroughSequence0 &&
    t10.generationBumpedCount === 0 &&
    t10.coldPaintCssomOk;

  const summary = {
    since,
    sessionId,
    surface,
    surfaceAfter,
    failCount: fails.length,
    fails: fails.slice(0, 25),
    consoleErrors: consoleLines.filter((l) => /\[error\]|\[pageerror\]/i.test(l)).length,
    factCount: facts.length,
    pageProjectionFactCounts: Object.fromEntries(pp),
    hasFrontActivity: Boolean(frontJsonl),
    t10,
  };
  fs.writeFileSync(path.join(OUT, `${PREFIX}-summary.json`), JSON.stringify(summary, null, 2));
  console.log("DONE", JSON.stringify(summary, null, 2));
  if (!t10.pass) {
    console.error("T10_BOOT_ASSERT_FAILED", JSON.stringify(t10, null, 2));
    process.exit(2);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
