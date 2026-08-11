/**
 * Live hunt against Beleza: wait out Akamai interstitial, then exercise + export.
 * Usage: node run-beleza-hunt.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const http = require("http");

const OUT = process.env.OUT_DIR || __dirname;
const BASE = process.env.BASE_URL || "http://127.0.0.1:8080";
const LIVE_URL = process.env.LIVE_URL || `${BASE}/`;
const PREFIX = "beleza";
const COLD_WAIT_MS = Number(process.env.COLD_WAIT_MS || 90000);
const SETTLE_MS = Number(process.env.SETTLE_MS || 8000);

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

async function measure(page) {
  return page.evaluate(() => {
    const e = document.querySelector("[data-speculum-dom-surface]");
    if (!e) return { error: "no_surface" };
    const body = e.querySelector("[data-speculum-dom-body]");
    const owned = [...e.querySelectorAll("style[data-speculum-cssom-id]")];
    let ownedRules = 0;
    for (const st of owned) {
      try {
        ownedRules += st.sheet?.cssRules?.length || 0;
      } catch {
        /* cors */
      }
    }
    const anchors = [...e.querySelectorAll("[speculum-anchor]")].map((n) =>
      n.getAttribute("speculum-anchor"),
    );
    const dup = {};
    for (const a of anchors) {
      if (!a) continue;
      dup[a] = (dup[a] || 0) + 1;
    }
    const dups = Object.entries(dup)
      .filter(([, n]) => n > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([a, n]) => ({ anchor: a, count: n }));

    const rows =
      typeof window.__speculumFrontDebugLog === "function"
        ? window.__speculumFrontDebugLog()
        : [];
    const hops = {};
    let desync = null;
    let framedErr = null;
    let armed = null;
    const desyncs = [];
    for (const r of rows) {
      const hop = r.fields?.hop || "?";
      hops[hop] = (hops[hop] || 0) + 1;
      if (hop === "client_desync") {
        const d = {
          reason: r.fields?.errorCode || r.fields?.reason,
          seq: r.fields?.sequence,
          phase: r.fields?.phase,
          matchCount: r.fields?.matchCount,
          selector: r.fields?.selectorQuery || r.fields?.extra?.selectorQuery,
          detail: String(r.detail || "").slice(0, 500),
        };
        if (!desync) desync = d;
        if (desyncs.length < 8) desyncs.push(d);
      }
      if (hop === "lifecycle" && /Invalid framed length/i.test(String(r.detail || ""))) {
        framedErr = String(r.detail || "").slice(0, 240);
      }
      if (hop === "client_arm") armed = true;
      if (hop === "client_disarm") armed = false;
    }

    const text = (e.innerText || "").trim();
    const accessDenied = /access denied|edgesuite|permission to access/i.test(text);
    const imgs = [...e.querySelectorAll("img")];
    const brokenImgs = imgs.filter((i) => !i.complete || i.naturalWidth === 0).length;
    const virtualData1x1 = imgs.filter((i) => {
      const s = i.getAttribute("src") || "";
      return s.includes("/w7s/virtual-data/") && i.naturalWidth <= 1;
    }).length;

    return {
      sessionId: window.__speculumSessionId || null,
      href: location.href,
      childCount: e.childElementCount,
      bodyKids: body?.childElementCount ?? null,
      htmlLen: e.innerHTML.length,
      textLen: text.length,
      text: text.slice(0, 400),
      accessDenied,
      scrollTop: e.scrollTop,
      scrollHeight: e.scrollHeight,
      clientHeight: e.clientHeight,
      ownedRules,
      styleCount: e.querySelectorAll("style").length,
      anchorCount: anchors.length,
      duplicateAnchors: dups,
      duplicateAnchorTotal: dups.reduce((s, x) => s + x.count, 0),
      frontHops: hops,
      desync,
      desyncs,
      framedErr,
      armedHint: armed,
      imgCount: imgs.length,
      brokenImgs,
      virtualData1x1,
      scriptSrc: document.querySelector('script[type="module"]')?.src || null,
    };
  });
}

function looksHealthy(m) {
  if (!m || m.error) return false;
  if (m.accessDenied) return false;
  if (m.framedErr) return false;
  // Real storefront: substantial DOM + some CSSOM + not WAF text
  return (
    (m.htmlLen || 0) > 40000 &&
    (m.textLen || 0) > 200 &&
    (m.ownedRules || 0) > 20 &&
    !/access denied/i.test(m.text || "")
  );
}

async function waitCold(page, ms = COLD_WAIT_MS) {
  const t0 = Date.now();
  let last = null;
  let sawDenied = false;
  let deniedClearedAt = null;
  while (Date.now() - t0 < ms) {
    last = await measure(page);
    if (last.accessDenied) sawDenied = true;
    if (sawDenied && !last.accessDenied && !deniedClearedAt) {
      deniedClearedAt = Date.now() - t0;
    }
    if (last.framedErr) {
      return { ...last, phase: "framed_error", waitedMs: Date.now() - t0, sawDenied, deniedClearedAt };
    }
    if (looksHealthy(last) && last.frontHops?.client_arm) {
      return {
        ...last,
        phase: "armed",
        waitedMs: Date.now() - t0,
        sawDenied,
        deniedClearedAt,
      };
    }
    if (looksHealthy(last) && Date.now() - t0 > 10000) {
      return {
        ...last,
        phase: "painted",
        waitedMs: Date.now() - t0,
        sawDenied,
        deniedClearedAt,
      };
    }
    await sleep(500);
  }
  return {
    ...last,
    phase: "timeout",
    waitedMs: ms,
    sawDenied,
    deniedClearedAt,
  };
}

async function act(page, name, fn) {
  const before = await measure(page);
  const t0 = Date.now();
  let err = null;
  try {
    await fn();
  } catch (e) {
    err = String(e && e.message ? e.message : e);
  }
  await sleep(1200);
  const after = await measure(page);
  return {
    name,
    ms: Date.now() - t0,
    err,
    before: {
      scrollTop: before.scrollTop,
      htmlLen: before.htmlLen,
      textLen: before.textLen,
      href: before.href,
      desync: before.desync,
      accessDenied: before.accessDenied,
      dups: before.duplicateAnchors?.length || 0,
    },
    after: {
      scrollTop: after.scrollTop,
      htmlLen: after.htmlLen,
      textLen: after.textLen,
      href: after.href,
      desync: after.desync,
      accessDenied: after.accessDenied,
      dups: after.duplicateAnchors?.length || 0,
      bodyKids: after.bodyKids,
      scrollHeight: after.scrollHeight,
      clientHeight: after.clientHeight,
    },
    delta: {
      scrollTop: (after.scrollTop || 0) - (before.scrollTop || 0),
      htmlLen: (after.htmlLen || 0) - (before.htmlLen || 0),
      textLen: (after.textLen || 0) - (before.textLen || 0),
      hrefChanged: before.href !== after.href,
    },
  };
}

(async () => {
  const since = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, `${PREFIX}-since.txt`), since);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const consoleLines = [];
  const netFails = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleLines.push(`[${msg.type()}] ${msg.text().slice(0, 400)}`);
    }
  });
  page.on("pageerror", (err) => consoleLines.push(`[pageerror] ${err.message}`));
  page.on("response", (res) => {
    const u = res.url();
    if (res.status() >= 400 && (u.includes("/w7s/") || u.includes("virtual-"))) {
      netFails.push({ status: res.status(), url: u.slice(0, 220) });
    }
  });

  console.log("GOTO", LIVE_URL);
  await page.goto(LIVE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Early snapshot (may be Access Denied)
  await sleep(2000);
  const early = await measure(page);
  fs.writeFileSync(path.join(OUT, `${PREFIX}-early.json`), JSON.stringify(early, null, 2));
  fs.writeFileSync(path.join(OUT, `${PREFIX}-early.png`), await page.screenshot({ fullPage: false }));
  console.log(
    "EARLY",
    JSON.stringify({
      accessDenied: early.accessDenied,
      htmlLen: early.htmlLen,
      textLen: early.textLen,
      ownedRules: early.ownedRules,
      text: (early.text || "").slice(0, 120),
    }),
  );

  const cold = await waitCold(page);
  console.log(
    "COLD",
    JSON.stringify({
      phase: cold.phase,
      sessionId: cold.sessionId,
      sawDenied: cold.sawDenied,
      deniedClearedAt: cold.deniedClearedAt,
      waitedMs: cold.waitedMs,
      ownedRules: cold.ownedRules,
      htmlLen: cold.htmlLen,
      textLen: cold.textLen,
      bodyKids: cold.bodyKids,
      accessDenied: cold.accessDenied,
      dups: cold.duplicateAnchors?.length,
      desync: cold.desync,
      framedErr: cold.framedErr,
      brokenImgs: cold.brokenImgs,
      virtualData1x1: cold.virtualData1x1,
    }),
  );
  fs.writeFileSync(path.join(OUT, `${PREFIX}-cold.json`), JSON.stringify(cold, null, 2));
  fs.writeFileSync(path.join(OUT, `${PREFIX}-cold.png`), await page.screenshot({ fullPage: false }));

  // Extra settle for late Diff / images
  await sleep(SETTLE_MS);
  const settled = await measure(page);
  fs.writeFileSync(path.join(OUT, `${PREFIX}-settled.json`), JSON.stringify(settled, null, 2));
  fs.writeFileSync(path.join(OUT, `${PREFIX}-settled.png`), await page.screenshot({ fullPage: false }));
  console.log(
    "SETTLED",
    JSON.stringify({
      htmlLen: settled.htmlLen,
      textLen: settled.textLen,
      ownedRules: settled.ownedRules,
      accessDenied: settled.accessDenied,
      desync: settled.desync,
      dups: settled.duplicateAnchors?.length,
      scrollHeight: settled.scrollHeight,
      brokenImgs: settled.brokenImgs,
      virtualData1x1: settled.virtualData1x1,
    }),
  );

  const acts = [];
  const box = await page.locator("[data-speculum-dom-surface]").first().boundingBox();
  if (!box) {
    console.error("NO_SURFACE");
    process.exit(2);
  }
  const cx = box.x + Math.min(box.width * 0.4, 480);
  const cy = box.y + Math.min(box.height * 0.45, 360);

  if (!settled.accessDenied && (settled.htmlLen || 0) > 5000) {
    acts.push(
      await act(page, "wheel_down_800", async () => {
        await page.mouse.move(cx, cy);
        for (let i = 0; i < 4; i++) {
          await page.mouse.wheel(0, 400);
          await sleep(200);
        }
      }),
    );
    acts.push(
      await act(page, "wheel_up_400", async () => {
        await page.mouse.move(cx, cy);
        await page.mouse.wheel(0, -400);
      }),
    );
    acts.push(
      await act(page, "click_center", async () => {
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.up();
      }),
    );
    acts.push(
      await act(page, "click_navish", async () => {
        const link = page
          .locator("[data-speculum-dom-surface] a, [data-speculum-dom-surface] button")
          .filter({
            hasText: /promo|cabelo|entrar|buscar|perfume|skincare|maquiagem|corpo|rosto|cabelos/i,
          })
          .first();
        await link.click({ timeout: 5000, force: true });
      }),
    );
    acts.push(
      await act(page, "search_type", async () => {
        const input = page
          .locator(
            "[data-speculum-dom-surface] input[type='search'], [data-speculum-dom-surface] input[placeholder*='Busque' i], [data-speculum-dom-surface] input[type='text'], [data-speculum-dom-surface] input:not([type])",
          )
          .first();
        await input.click({ timeout: 5000 });
        await page.keyboard.type("shampoo", { delay: 50 });
      }),
    );
    acts.push(
      await act(page, "search_enter", async () => {
        await page.keyboard.press("Enter");
        await sleep(2500);
      }),
    );
  }

  await sleep(2000);
  const final = await measure(page);
  fs.writeFileSync(path.join(OUT, `${PREFIX}-final.json`), JSON.stringify(final, null, 2));
  fs.writeFileSync(path.join(OUT, `${PREFIX}-final.png`), await page.screenshot({ fullPage: false }));
  fs.writeFileSync(path.join(OUT, `${PREFIX}-acts.json`), JSON.stringify(acts, null, 2));
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-browser-console.txt`),
    consoleLines.join("\n"),
  );
  fs.writeFileSync(path.join(OUT, `${PREFIX}-net-fails.json`), JSON.stringify(netFails, null, 2));

  // Front activity dump
  const front = await page.evaluate(() => {
    const rows =
      typeof window.__speculumFrontDebugLog === "function"
        ? window.__speculumFrontDebugLog()
        : [];
    return rows.slice(-2500);
  });
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-front-activity.jsonl`),
    front.map((r) => JSON.stringify(r)).join("\n") + (front.length ? "\n" : ""),
  );

  const sessionId = final.sessionId || cold.sessionId || settled.sessionId;
  let journal = null;
  try {
    if (sessionId) {
      const exp = await getJson(`/w7s/api/sessions/${sessionId}/journal-export`);
      journal = exp;
      if (typeof exp.body === "object") {
        fs.writeFileSync(
          path.join(OUT, `${PREFIX}-journal-export.json`),
          JSON.stringify(exp.body, null, 2),
        );
      }
      const globalJ = await getJson(
        `/w7s/api/journal?take=8000&since=${encodeURIComponent(since)}`,
      );
      if (typeof globalJ.body === "object") {
        fs.writeFileSync(
          path.join(OUT, `${PREFIX}-journal-since.json`),
          JSON.stringify(globalJ.body, null, 2),
        );
      }
    }
  } catch (e) {
    console.warn("journal export failed", e.message || e);
  }

  const summary = {
    since,
    sessionId,
    early: {
      accessDenied: early.accessDenied,
      htmlLen: early.htmlLen,
      text: (early.text || "").slice(0, 160),
    },
    cold: {
      phase: cold.phase,
      waitedMs: cold.waitedMs,
      sawDenied: cold.sawDenied,
      deniedClearedAt: cold.deniedClearedAt,
      accessDenied: cold.accessDenied,
      htmlLen: cold.htmlLen,
      ownedRules: cold.ownedRules,
      desync: cold.desync,
      framedErr: cold.framedErr,
      dups: cold.duplicateAnchors,
    },
    settled: {
      htmlLen: settled.htmlLen,
      textLen: settled.textLen,
      ownedRules: settled.ownedRules,
      accessDenied: settled.accessDenied,
      desync: settled.desync,
      dups: settled.duplicateAnchors,
      brokenImgs: settled.brokenImgs,
      virtualData1x1: settled.virtualData1x1,
      scrollHeight: settled.scrollHeight,
      clientHeight: settled.clientHeight,
    },
    final: {
      htmlLen: final.htmlLen,
      textLen: final.textLen,
      desync: final.desync,
      dups: final.duplicateAnchors,
      accessDenied: final.accessDenied,
      frontHops: final.frontHops,
    },
    acts: acts.map((a) => ({
      name: a.name,
      delta: a.delta,
      err: a.err ? a.err.slice(0, 160) : null,
      desyncAfter: !!a.after.desync,
    })),
    consoleCount: consoleLines.length,
    netFailCount: netFails.length,
    journalFactCount:
      journal && typeof journal.body === "object" ? journal.body.factCount : null,
  };
  fs.writeFileSync(path.join(OUT, `${PREFIX}-summary.json`), JSON.stringify(summary, null, 2));
  console.log("DONE", JSON.stringify(summary, null, 2));
  console.log(
    "acts",
    acts
      .map(
        (a) =>
          `${a.name}: Δscroll=${a.delta.scrollTop} Δhtml=${a.delta.htmlLen} err=${a.err ? "Y" : "N"} desync=${a.after.desync ? "Y" : "N"}`,
      )
      .join(" | "),
  );

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
