/**
 * Focused PageProjection Intent telemetry harvest.
 * Exercises clicks, wheel, element scroll, search type/Enter, category links.
 * Usage: node run-input-diag.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const http = require("http");

const OUT = process.env.OUT_DIR || __dirname;
const BASE = process.env.BASE_URL || "http://127.0.0.1:8080";
const LIVE_URL = process.env.LIVE_URL || `${BASE}/`;
const PREFIX = "input";

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
      return {
        childCount: e.childElementCount,
        htmlLen: e.innerHTML.length,
        scrollTop: e.scrollTop,
        text: (e.innerText || "").slice(0, 400),
        ownedRules,
        href: location.href,
        sessionId: window.__speculumSessionId || null,
      };
    })
    .catch((e) => ({ error: String(e) }));
}

async function frontSnapshot(page, label) {
  return page
    .evaluate((lab) => {
      const rows =
        typeof window.__speculumFrontDebugLog === "function"
          ? window.__speculumFrontDebugLog()
          : [];
      const since = Number(window.__speculumInputDiagMark || 0);
      const fresh = rows.filter((r) => (r.at || 0) >= since);
      const intents = fresh.filter(
        (r) =>
          r.fields?.plane === "pageProjectionIntent"
          || /dom_input|programmaticSuppress/i.test(r.label || ""),
      );
      const diffs = fresh.filter(
        (r) =>
          r.fields?.plane === "pageProjectionDiff"
          || /page_projection/i.test(r.label || ""),
      );
      return {
        label: lab,
        total: rows.length,
        fresh: fresh.length,
        intentLabels: intents.map((r) => ({
          at: r.at,
          label: r.label,
          kind: r.fields?.kind,
          hop: r.fields?.hop,
          gen: r.fields?.generation,
          anchor: r.fields?.anchor,
          errorCode: r.fields?.errorCode,
          scrollY: r.fields?.scrollY,
          scrollTop: r.fields?.scrollTop,
          key: r.fields?.key,
        })),
        diffHops: diffs.slice(-40).map((r) => ({
          at: r.at,
          label: r.label,
          hop: r.fields?.hop,
          kind: r.fields?.kind,
          seq: r.fields?.sequence,
          gen: r.fields?.generation,
          reason: r.fields?.errorCode || r.fields?.reason,
        })),
      };
    }, label)
    .catch((e) => ({ error: String(e), label }));
}

async function markFront(page) {
  await page.evaluate(() => {
    window.__speculumInputDiagMark = performance.now();
  });
}

async function act(page, name, fn) {
  await markFront(page);
  const before = await measureSurface(page);
  const t0 = Date.now();
  let err = null;
  try {
    await fn();
  } catch (e) {
    err = String(e && e.message ? e.message : e);
  }
  await sleep(900);
  const after = await measureSurface(page);
  const front = await frontSnapshot(page, name);
  return {
    name,
    ms: Date.now() - t0,
    err,
    before: {
      scrollTop: before.scrollTop,
      htmlLen: before.htmlLen,
      text: (before.text || "").slice(0, 120),
      href: before.href,
    },
    after: {
      scrollTop: after.scrollTop,
      htmlLen: after.htmlLen,
      text: (after.text || "").slice(0, 120),
      href: after.href,
    },
    delta: {
      scrollTop: (after.scrollTop || 0) - (before.scrollTop || 0),
      htmlLen: (after.htmlLen || 0) - (before.htmlLen || 0),
      textChanged: (before.text || "").slice(0, 80) !== (after.text || "").slice(0, 80),
      hrefChanged: before.href !== after.href,
    },
    front,
  };
}

(async () => {
  const since = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, `${PREFIX}-since.txt`), since);
  const acts = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const consoleLines = [];
  page.on("console", (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => consoleLines.push(`[pageerror] ${err.message}`));

  console.log("GOTO", LIVE_URL);
  await page.goto(LIVE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  let surface = null;
  let sessionId = null;
  for (let i = 0; i < 60; i++) {
    surface = await measureSurface(page);
    sessionId = surface.sessionId || null;
    if (surface && !surface.error && surface.childCount > 0 && surface.ownedRules > 10) break;
    await sleep(400);
  }
  fs.writeFileSync(path.join(OUT, `${PREFIX}-cold.png`), await page.screenshot({ fullPage: false }));
  console.log("COLD", JSON.stringify({ sessionId, ownedRules: surface?.ownedRules, htmlLen: surface?.htmlLen }));

  const box = await page.locator("[data-speculum-dom-surface]").first().boundingBox();
  if (!box) {
    console.error("NO_SURFACE_BOX");
    process.exit(2);
  }
  const cx = box.x + Math.min(box.width * 0.45, 500);
  const cy = box.y + Math.min(box.height * 0.4, 320);

  // Dismiss cookie/geo overlays if present (click projected Accept if visible).
  acts.push(
    await act(page, "dismiss_overlay_click", async () => {
      const btn = page
        .locator("[data-speculum-dom-surface] button, [data-speculum-dom-surface] [role='button']")
        .filter({ hasText: /accept|aceitar|sim|ok|got it/i })
        .first();
      if (await btn.count()) {
        await btn.click({ timeout: 2000 }).catch(() => {});
      } else {
        await page.mouse.click(cx + 200, cy + 250, { button: "left" });
      }
    }),
  );

  acts.push(
    await act(page, "mousemove_then_click_hero", async () => {
      await page.mouse.move(cx, cy);
      await sleep(80);
      for (let i = 0; i < 6; i++) {
        await page.mouse.move(cx + i * 12, cy + (i % 2) * 6);
        await sleep(30);
      }
      await page.mouse.click(cx, cy, { button: "left" });
    }),
  );

  acts.push(
    await act(page, "wheel_down_800", async () => {
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, 800);
    }),
  );

  acts.push(
    await act(page, "wheel_up_400", async () => {
      await page.mouse.wheel(0, -400);
    }),
  );

  acts.push(
    await act(page, "click_categories_nav", async () => {
      const cat = page
        .locator("[data-speculum-dom-surface] a, [data-speculum-dom-surface] button")
        .filter({ hasText: /^Categories$|Games -90%|Steam$/i })
        .first();
      if (await cat.count()) {
        await cat.click({ timeout: 3000 });
      } else {
        await page.mouse.click(cx - 200, box.y + 130, { button: "left" });
      }
    }),
  );

  acts.push(
    await act(page, "search_focus_type", async () => {
      const search = page
        .locator(
          "[data-speculum-dom-surface] input[type='search'], [data-speculum-dom-surface] input[placeholder*='earch' i]",
        )
        .first();
      if (!(await search.count())) throw new Error("no search input");
      await search.click({ timeout: 3000 });
      await sleep(200);
      await page.keyboard.type("steam", { delay: 50 });
    }),
  );

  acts.push(
    await act(page, "search_enter", async () => {
      await page.keyboard.press("Enter");
      await sleep(1500);
    }),
  );

  acts.push(
    await act(page, "click_productish", async () => {
      const card = page
        .locator("[data-speculum-dom-surface] a")
        .filter({ hasText: /steam|gift|buy|view offers|add to cart/i })
        .first();
      if (await card.count()) {
        await card.click({ timeout: 3000 });
      } else {
        await page.mouse.click(cx, cy + 180, { button: "left" });
      }
    }),
  );

  acts.push(
    await act(page, "wheel_after_nav", async () => {
      await page.mouse.move(cx, cy + 100);
      await page.mouse.wheel(0, 600);
    }),
  );

  // Capture mid-session screenshots
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-after-acts.png`),
    await page.screenshot({ fullPage: false }),
  );

  // Full front ring
  const frontExport = await page
    .evaluate(() => {
      const hasLog = typeof window.__speculumFrontDebugLog === "function";
      const rows = hasLog ? window.__speculumFrontDebugLog() : [];
      return {
        hasLog,
        sessionId: window.__speculumSessionId || null,
        count: Array.isArray(rows) ? rows.length : 0,
        rows: Array.isArray(rows) ? rows : [],
      };
    })
    .catch((e) => ({ error: String(e) }));

  if (frontExport?.rows?.length) {
    fs.writeFileSync(
      path.join(OUT, `${PREFIX}-front-activity.jsonl`),
      frontExport.rows.map((r) => JSON.stringify(r)).join("\n"),
    );
  }
  sessionId = frontExport?.sessionId || sessionId || surface?.sessionId;

  await page.goto(`${BASE}/w7s/lab`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await sleep(2500);
  await browser.close();

  let journal = null;
  if (sessionId) {
    const exp = await getJson(`/w7s/api/sessions/${sessionId}/journal-export`);
    journal = exp.body;
    fs.writeFileSync(
      path.join(OUT, `${PREFIX}-journal-export.json`),
      JSON.stringify(journal, null, 2),
    );
  }

  const summary = {
    since,
    sessionId,
    cold: surface,
    acts: acts.map((a) => ({
      name: a.name,
      ms: a.ms,
      err: a.err,
      delta: a.delta,
      before: a.before,
      after: a.after,
      intentCount: a.front?.intentLabels?.length ?? 0,
      intentKinds: (a.front?.intentLabels || []).map((x) => x.kind || x.label),
    })),
    frontCount: frontExport?.count ?? 0,
    factCount: journal?.facts?.length ?? 0,
  };
  fs.writeFileSync(path.join(OUT, `${PREFIX}-acts.json`), JSON.stringify(acts, null, 2));
  fs.writeFileSync(path.join(OUT, `${PREFIX}-summary.json`), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, `${PREFIX}-browser-console.txt`), consoleLines.join("\n"));
  console.log("DONE", JSON.stringify(summary, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
