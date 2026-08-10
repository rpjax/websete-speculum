/**
 * Full Live bug hunt: cold paint, desync/framing, inputs, export front+journal.
 * Usage: node run-bug-hunt.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const http = require("http");

const OUT = process.env.OUT_DIR || __dirname;
const BASE = process.env.BASE_URL || "http://127.0.0.1:8080";
// Do NOT put cache-bust query on `/` — Live maps location.search onto the
// remote start URL (pollutes target + can trip WAFs).
const LIVE_URL = process.env.LIVE_URL || `${BASE}/`;
const PREFIX = "bughunt";

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

function postJson(urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath.startsWith("http") ? urlPath : `${BASE}${urlPath}`);
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
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
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
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
      .slice(0, 20)
      .map(([a, n]) => ({ anchor: a, count: n }));

    const rows =
      typeof window.__speculumFrontDebugLog === "function"
        ? window.__speculumFrontDebugLog()
        : [];
    const hops = {};
    let desync = null;
    let framedErr = null;
    let armed = null;
    for (const r of rows) {
      const hop = r.fields?.hop || "?";
      hops[hop] = (hops[hop] || 0) + 1;
      if (hop === "client_desync" && !desync) {
        desync = {
          reason: r.fields?.errorCode || r.fields?.reason,
          seq: r.fields?.sequence,
          phase: r.fields?.phase,
          matchCount: r.fields?.matchCount,
          selector: r.fields?.selectorQuery || r.fields?.extra?.selectorQuery,
          detail: String(r.detail || "").slice(0, 400),
        };
      }
      if (hop === "lifecycle" && /Invalid framed length/i.test(String(r.detail || ""))) {
        framedErr = String(r.detail || "").slice(0, 200);
      }
      if (hop === "client_arm") armed = true;
      if (hop === "client_disarm") armed = false;
    }

    return {
      sessionId: window.__speculumSessionId || null,
      href: location.href,
      childCount: e.childElementCount,
      bodyKids: body?.childElementCount ?? null,
      htmlLen: e.innerHTML.length,
      textLen: (e.innerText || "").trim().length,
      text: (e.innerText || "").trim().slice(0, 240),
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
      framedErr,
      armedHint: armed,
      scriptSrc: document.querySelector('script[type="module"]')?.src || null,
      maxMessageHint: null,
    };
  });
}

async function waitCold(page, ms = 45000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await measure(page);
    if (last.framedErr) return { ...last, phase: "framed_error" };
    if (last.desync) return { ...last, phase: "desynced", waitedMs: Date.now() - t0 };
    if (
      last.childCount > 0
      && last.ownedRules > 10
      && last.textLen > 40
      && last.frontHops.client_arm
    ) {
      return { ...last, phase: "armed", waitedMs: Date.now() - t0 };
    }
    if (last.childCount > 0 && last.ownedRules > 10 && last.textLen > 40) {
      // paint without explicit arm hop yet
      if (Date.now() - t0 > 8000) return { ...last, phase: "painted", waitedMs: Date.now() - t0 };
    }
    await sleep(400);
  }
  return { ...last, phase: "timeout", waitedMs: ms };
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
  await sleep(1000);
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
      dups: before.duplicateAnchors?.length || 0,
    },
    after: {
      scrollTop: after.scrollTop,
      htmlLen: after.htmlLen,
      textLen: after.textLen,
      href: after.href,
      desync: after.desync,
      dups: after.duplicateAnchors?.length || 0,
      bodyKids: after.bodyKids,
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
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleLines.push(`[${msg.type()}] ${msg.text().slice(0, 300)}`);
    }
  });
  page.on("pageerror", (err) => consoleLines.push(`[pageerror] ${err.message}`));

  console.log("GOTO", LIVE_URL);
  await page.goto(LIVE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  const cold = await waitCold(page);
  console.log(
    "COLD",
    JSON.stringify({
      phase: cold.phase,
      sessionId: cold.sessionId,
      ownedRules: cold.ownedRules,
      htmlLen: cold.htmlLen,
      textLen: cold.textLen,
      bodyKids: cold.bodyKids,
      dups: cold.duplicateAnchors?.length,
      desync: cold.desync,
      framedErr: cold.framedErr,
      waitedMs: cold.waitedMs,
      scriptSrc: cold.scriptSrc,
    }),
  );
  fs.writeFileSync(path.join(OUT, `${PREFIX}-cold.json`), JSON.stringify(cold, null, 2));
  fs.writeFileSync(path.join(OUT, `${PREFIX}-cold.png`), await page.screenshot({ fullPage: false }));

  const acts = [];
  const box = await page.locator("[data-speculum-dom-surface]").first().boundingBox();
  if (!box) {
    console.error("NO_SURFACE");
    process.exit(2);
  }
  const cx = box.x + Math.min(box.width * 0.45, 520);
  const cy = box.y + Math.min(box.height * 0.35, 280);

  // Only exercise if we have some paint
  if ((cold.htmlLen || 0) > 1000) {
    acts.push(
      await act(page, "click_center", async () => {
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.up();
      }),
    );
    acts.push(
      await act(page, "wheel_down_600", async () => {
        await page.mouse.move(cx, cy);
        await page.mouse.wheel(0, 600);
      }),
    );
    acts.push(
      await act(page, "wheel_up_300", async () => {
        await page.mouse.move(cx, cy);
        await page.mouse.wheel(0, -300);
      }),
    );
    acts.push(
      await act(page, "click_navish", async () => {
        const link = page
          .locator("[data-speculum-dom-surface] a, [data-speculum-dom-surface] button")
          .filter({
            hasText:
              /promo|cabelo|entrar|buscar|search|categor|perfume|skincare|login|games|steam|store|log in|register/i,
          })
          .first();
        await link.click({ timeout: 4000, force: true });
      }),
    );
    acts.push(
      await act(page, "search_type", async () => {
        const input = page
          .locator(
            "[data-speculum-dom-surface] input[type='search'], [data-speculum-dom-surface] input[type='text'], [data-speculum-dom-surface] input:not([type])",
          )
          .first();
        await input.click({ timeout: 4000 });
        await page.keyboard.type("steam", { delay: 40 });
      }),
    );
    acts.push(
      await act(page, "search_enter", async () => {
        await page.keyboard.press("Enter");
        await sleep(1500);
      }),
    );
  }

  const final = await measure(page);
  fs.writeFileSync(path.join(OUT, `${PREFIX}-final.png`), await page.screenshot({ fullPage: false }));
  fs.writeFileSync(path.join(OUT, `${PREFIX}-final.json`), JSON.stringify(final, null, 2));
  fs.writeFileSync(path.join(OUT, `${PREFIX}-acts.json`), JSON.stringify(acts, null, 2));

  // Export front activity
  const frontJsonl = await page.evaluate(() => {
    if (typeof window.__speculumExportFrontDebugJsonl === "function") {
      return window.__speculumExportFrontDebugJsonl();
    }
    const rows =
      typeof window.__speculumFrontDebugLog === "function"
        ? window.__speculumFrontDebugLog()
        : [];
    return rows.map((r) => JSON.stringify(r)).join("\n");
  });
  fs.writeFileSync(path.join(OUT, `${PREFIX}-front-activity.jsonl`), frontJsonl || "");

  const sessionId = final.sessionId || cold.sessionId;
  // Journal export via admin login
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

  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-browser-console.txt`),
    consoleLines.slice(-200).join("\n"),
  );

  const summary = {
    since,
    sessionId,
    coldPhase: cold.phase,
    cold,
    acts,
    final: {
      phaseHints: {
        desync: final.desync,
        framedErr: final.framedErr,
        dups: final.duplicateAnchors?.length,
        bodyKids: final.bodyKids,
        textLen: final.textLen,
        scrollHeight: final.scrollHeight,
        clientHeight: final.clientHeight,
      },
      frontHops: final.frontHops,
      duplicateAnchors: final.duplicateAnchors,
    },
    journalStatus: journal?.status ?? null,
    journalFactCount: journal?.body?.factCount ?? journal?.body?.facts?.length ?? null,
    frontLines: (frontJsonl || "").split(/\n/).filter(Boolean).length,
    consoleErrors: consoleLines.filter((l) => /error|pageerror/i.test(l)).length,
  };
  fs.writeFileSync(path.join(OUT, `${PREFIX}-summary.json`), JSON.stringify(summary, null, 2));
  console.log("DONE", JSON.stringify(summary.final.phaseHints));
  console.log(
    "acts",
    acts.map((a) => `${a.name}: Δscroll=${a.delta.scrollTop} Δhtml=${a.delta.htmlLen} err=${a.err ? "Y" : "N"}`).join(" | "),
  );

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
