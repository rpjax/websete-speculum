/**
 * Full smoke (visual artifacts + telemetry): Beleza settle/scroll + Eneba SoftNav→PDP.
 * Usage: node run-fullsmoke-human.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const http = require("http");

const OUT = process.env.OUT_DIR || __dirname;
const BASE = process.env.BASE_URL || "http://127.0.0.1:8080";
const PREFIX = "fullsmoke2";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath.startsWith("http") ? urlPath : `${BASE}${urlPath}`);
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method,
        headers: data
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
          : {},
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
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

async function putNav(host) {
  await req("PUT", "/w7s/api/configurations/Navigation", {
    defaultTargetHost: host,
    allowedMainFrameUrls: [
      {
        domain: { scope: "any", labels: [] },
        path: { scope: "any", matchType: "exact", segments: [] },
      },
    ],
  });
}

async function measure(page) {
  return page.evaluate(() => {
    const e = document.querySelector("[data-speculum-dom-surface]");
    if (!e) return { error: "no_surface" };
    const owned = [...e.querySelectorAll("style[data-speculum-cssom-id]")];
    let ownedRules = 0;
    for (const st of owned) {
      try {
        ownedRules += st.sheet?.cssRules?.length || 0;
      } catch {
        /* */
      }
    }
    const text = (e.innerText || "").trim();
    const accessDenied = /access denied|edgesuite|permission to access/i.test(text);
    const imgs = [...e.querySelectorAll("img")];
    const brokenImgs = imgs.filter((i) => !i.complete || i.naturalWidth === 0).length;
    const navOk = imgs.filter((i) => {
      const s = i.getAttribute("src") || "";
      return (s.includes("logo") || s.includes("brand") || i.closest("header,nav")) && i.naturalWidth > 0;
    }).length;
    const virtualData1x1 = imgs.filter((i) => {
      const s = i.getAttribute("src") || "";
      return s.includes("/w7s/virtual-data/") && i.naturalWidth <= 1;
    }).length;
    const srcsets = [...e.querySelectorAll("[srcset], [imagesrcset]")].map((n) => ({
      tag: n.tagName,
      srcset: (n.getAttribute("srcset") || n.getAttribute("imagesrcset") || "").slice(0, 500),
    }));
    const truncatedAvif = srcsets.filter((s) => /\/f_avif(\s|,|$|\?)/.test(s.srcset)).length;
    const cloudinaryFull = srcsets.filter(
      (s) =>
        /f_avif,fl_progressive,q_auto/.test(s.srcset) ||
        /f_avif%2Cfl_progressive%2Cq_auto/.test(s.srcset) ||
        /f_avif,q_auto/.test(s.srcset),
    ).length;
    const rows =
      typeof window.__speculumFrontDebugLog === "function"
        ? window.__speculumFrontDebugLog()
        : [];
    const desyncs = [];
    const hops = {};
    for (const r of rows) {
      const hop = r.fields?.hop || "?";
      hops[hop] = (hops[hop] || 0) + 1;
      if (hop === "client_desync") {
        desyncs.push({
          reason: r.fields?.errorCode || r.fields?.reason,
          seq: r.fields?.sequence,
          expected: r.fields?.expectedSequence,
          phase: r.fields?.phase,
          matchCount: r.fields?.matchCount,
          selector: r.fields?.extra?.selectorQuery || r.fields?.selectorQuery,
        });
      }
    }
    return {
      sessionId: window.__speculumSessionId || null,
      href: location.href,
      htmlLen: e.innerHTML.length,
      textLen: text.length,
      text: text.slice(0, 400),
      accessDenied,
      ownedRules,
      brokenImgs,
      imgCount: imgs.length,
      navOk,
      virtualData1x1,
      truncatedAvif,
      cloudinaryFull,
      srcsetSample: srcsets.slice(0, 6),
      desyncs,
      addressMiss: desyncs.filter((d) => d.reason === "address_miss").length,
      sequenceGap: desyncs.filter((d) => d.reason === "sequence_gap").length,
      hops,
      observeCount: rows.length,
      armed: !!hops.client_arm && !hops.client_disarm,
    };
  });
}

async function waitHealthy(page, ms) {
  const t0 = Date.now();
  let last = null;
  let sawDenied = false;
  while (Date.now() - t0 < ms) {
    last = await measure(page);
    if (last.accessDenied) sawDenied = true;
    const ok =
      !last.accessDenied &&
      (last.htmlLen || 0) > 40000 &&
      (last.ownedRules || 0) > 20 &&
      (last.textLen || 0) > 200;
    if (ok) return { ...last, waitedMs: Date.now() - t0, sawDenied, phase: "ok" };
    await sleep(500);
  }
  return { ...last, waitedMs: ms, sawDenied, phase: "timeout" };
}

async function exportSession(page, label) {
  const front = await page.evaluate(() => {
    const rows =
      typeof window.__speculumFrontDebugLog === "function"
        ? window.__speculumFrontDebugLog()
        : [];
    return rows.slice(-2500);
  });
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-${label}-front-activity.jsonl`),
    front.map((r) => JSON.stringify(r)).join("\n") + (front.length ? "\n" : ""),
  );
  const hopSummary = {};
  for (const r of front) {
    const hop = r.fields?.hop || "?";
    hopSummary[hop] = (hopSummary[hop] || 0) + 1;
  }
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-${label}-front-summary.json`),
    JSON.stringify({ count: front.length, hops: hopSummary }, null, 2),
  );
  const m = await measure(page);
  const sessionId = m.sessionId;
  if (sessionId) {
    const exp = await req("GET", `/w7s/api/sessions/${sessionId}/journal-export`);
    if (typeof exp.body === "object") {
      fs.writeFileSync(
        path.join(OUT, `${PREFIX}-${label}-journal-export.json`),
        JSON.stringify(exp.body, null, 2),
      );
    }
  }
  fs.writeFileSync(path.join(OUT, `${PREFIX}-${label}-measure.json`), JSON.stringify(m, null, 2));
  return { sessionId, measure: m };
}

function payloadSeq(fact) {
  try {
    const p = typeof fact.payload === "string" ? JSON.parse(fact.payload) : fact.payload;
    const s = p?.sequence ?? p?.seq ?? p?.maxSequence;
    return typeof s === "number" ? s : Number(s) || 0;
  } catch {
    return 0;
  }
}

function journalStats(label) {
  const p = path.join(OUT, `${PREFIX}-${label}-journal-export.json`);
  if (!fs.existsSync(p)) return {};
  const facts = JSON.parse(fs.readFileSync(p, "utf8")).facts || [];
  const bySuf = (suf) => facts.filter((f) => String(f.type || "").endsWith(suf));
  const count = (suf) => bySuf(suf).length;
  const maxSeq = (suf) => bySuf(suf).reduce((m, f) => Math.max(m, payloadSeq(f)), 0);
  const qd = bySuf("PageProjection.Diff.QueueDropped");
  const qdStages = {};
  for (const f of qd) {
    try {
      const pl = typeof f.payload === "string" ? JSON.parse(f.payload) : f.payload;
      const stage = String(pl?.stage || pl?.Stage || "?");
      qdStages[stage] = (qdStages[stage] || 0) + 1;
    } catch {
      qdStages["?"] = (qdStages["?"] || 0) + 1;
    }
  }
  const fr = count("PageProjection.Diff.FrameReceived");
  const wd = count("PageProjection.Diff.WireDelivered");
  const frMax = maxSeq("PageProjection.Diff.FrameReceived");
  const wdMax = maxSeq("PageProjection.Diff.WireDelivered");
  return {
    facts: facts.length,
    SoftNavObserved: count("PageProjection.Diff.SoftNavObserved"),
    ResyncRequested: count("PageProjection.Diff.ResyncRequested"),
    ResyncServed: count("PageProjection.Diff.ResyncServed"),
    QueueDropped: count("PageProjection.Diff.QueueDropped"),
    QueueDroppedStages: qdStages,
    GenerationBumped: count("PageProjection.Diff.GenerationBumped"),
    FrameReceived: fr,
    WireDelivered: wd,
    FrameReceivedMaxSeq: frMax,
    WireDeliveredMaxSeq: wdMax,
    FrMinusWd: fr - wd,
    FrMaxMinusWdMax: frMax - wdMax,
    silentStall: frMax > wdMax + 256 && count("PageProjection.Diff.QueueDropped") === 0 && wdMax > 0,
    InputApplied: count("Input.Applied"),
    InputRejected: count("Input.Rejected"),
  };
}

(async () => {
  const since = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, `${PREFIX}-since.txt`), since);
  const netFails = [];
  const summary = { since, beleza: null, eneba: null, bugs: [] };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ignoreHTTPSErrors: true,
  });

  // -------- Beleza --------
  console.log("=== BELEZA ===");
  await putNav("www.belezanaweb.com.br");
  const bPage = await context.newPage();
  bPage.on("response", (res) => {
    const u = res.url();
    if (res.status() >= 400 && (u.includes("/w7s/") || u.includes("virtual-"))) {
      netFails.push({ site: "beleza", status: res.status(), url: u.slice(0, 280) });
    }
  });
  await bPage.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const belezaEarly = await waitHealthy(bPage, 90000);
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-beleza-t8.png`),
    await bPage.screenshot({ fullPage: false }),
  );
  // Long settle to stress Diff fan-out / wire
  await sleep(35000);
  // Scroll projected surface via CDP-ish evaluate
  await bPage.evaluate(() => {
    const e = document.querySelector("[data-speculum-dom-surface]");
    if (e) e.scrollTop = 900;
  });
  await sleep(2000);
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-beleza-scrolled.png`),
    await bPage.screenshot({ fullPage: false }),
  );
  // Wait for fan-out budget if stalled
  await sleep(16000);
  const belezaSettled = await measure(bPage);
  await exportSession(bPage, "beleza");
  const bj = journalStats("beleza");
  summary.beleza = {
    ...belezaSettled,
    waitedMs: belezaEarly.waitedMs,
    sawDenied: belezaEarly.sawDenied,
    earlyPhase: belezaEarly.phase,
    journal: bj,
    truncatedAvifNet: netFails.filter(
      (n) => n.site === "beleza" && /f_avif(\s|$|\?)/.test(n.url) && !/q_auto/.test(n.url),
    ).length,
  };
  if (bj.silentStall) summary.bugs.push("WIRE_STALL_SILENT_BELEZA");
  if ((belezaSettled.addressMiss || 0) > 0) summary.bugs.push("ADDRESS_MISS_BELEZA");
  if ((belezaSettled.truncatedAvif || 0) > 0 && (belezaSettled.cloudinaryFull || 0) === 0) {
    summary.bugs.push("BELEZA_SRCSET_TRUNCATED_SUSPECT");
  }
  console.log(
    "BELEZA",
    JSON.stringify({
      phase: belezaEarly.phase,
      accessDenied: belezaSettled.accessDenied,
      ownedRules: belezaSettled.ownedRules,
      brokenImgs: belezaSettled.brokenImgs,
      cloudinaryFull: belezaSettled.cloudinaryFull,
      truncatedAvif: belezaSettled.truncatedAvif,
      virtualData1x1: belezaSettled.virtualData1x1,
      addressMiss: belezaSettled.addressMiss,
      journal: bj,
      sessionId: belezaSettled.sessionId,
    }),
  );
  await bPage.close();

  // -------- Eneba SoftNav → PDP --------
  console.log("=== ENEBA ===");
  await putNav("www.eneba.com");
  await sleep(500);
  const ePage = await context.newPage();
  ePage.on("response", (res) => {
    const u = res.url();
    if (res.status() >= 400 && (u.includes("/w7s/") || u.includes("virtual-"))) {
      netFails.push({ site: "eneba", status: res.status(), url: u.slice(0, 280) });
    }
  });
  await ePage.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const enebaCold = await waitHealthy(ePage, 60000);
  // Locale SoftNav settle
  await sleep(8000);
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-eneba-cold.png`),
    await ePage.screenshot({ fullPage: false }),
  );
  console.log(
    "ENEBA cold",
    JSON.stringify({
      phase: enebaCold.phase,
      ownedRules: enebaCold.ownedRules,
      htmlLen: enebaCold.htmlLen,
      addressMiss: enebaCold.addressMiss,
      sessionId: enebaCold.sessionId,
    }),
  );

  try {
    const surface = ePage.locator("[data-speculum-dom-surface]");
    for (const t of [/Accept/i, /Aceitar/i, /\bSim\b/, /Yes/i, /Agree/i, /Got it/i, /Continuar/i]) {
      const btn = surface.getByText(t).first();
      if (await btn.isVisible({ timeout: 700 }).catch(() => false)) {
        await btn.click({ force: true, timeout: 2000 }).catch(() => {});
        await sleep(400);
      }
    }
  } catch {
    /* */
  }

  // Prefer homepage product card SoftNav (fullsmoke path)
  let softNavPath = "none";
  try {
    const card = ePage
      .locator("[data-speculum-dom-surface] a")
      .filter({ hasText: /spider.?man|marvel/i })
      .first();
    if (await card.isVisible({ timeout: 4000 }).catch(() => false)) {
      await card.click({ force: true, timeout: 6000 });
      softNavPath = "home-card";
      await sleep(12000);
    } else {
      throw new Error("no card");
    }
  } catch (e) {
    console.warn("card click failed", e.message || e);
    try {
      const input = ePage
        .locator(
          "[data-speculum-dom-surface] input[type='search'], [data-speculum-dom-surface] input[type='text']",
        )
        .first();
      await input.click({ timeout: 5000 });
      await ePage.keyboard.type("spider man remastered", { delay: 35 });
      await sleep(700);
      await ePage.keyboard.press("Enter");
      softNavPath = "search";
      await sleep(6000);
      const result = ePage
        .locator("[data-speculum-dom-surface] a")
        .filter({ hasText: /spider.?man|marvel/i })
        .first();
      if (await result.isVisible({ timeout: 6000 }).catch(() => false)) {
        await result.click({ force: true, timeout: 8000 });
        softNavPath = "search-pdp";
        await sleep(12000);
      }
    } catch (e2) {
      console.warn("search→pdp failed", e2.message || e2);
    }
  }

  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-eneba-after-click.png`),
    await ePage.screenshot({ fullPage: false }),
  );
  await sleep(16000);
  const enebaExp = await exportSession(ePage, "eneba");
  const ej = journalStats("eneba");
  summary.eneba = {
    ...enebaExp.measure,
    coldWaitedMs: enebaCold.waitedMs,
    softNavPath,
    journal: ej,
  };
  if (ej.silentStall) summary.bugs.push("WIRE_STALL_SILENT_ENEBA");
  if ((enebaExp.measure.addressMiss || 0) > 0) summary.bugs.push("ADDRESS_MISS_ENEBA");
  if ((enebaExp.measure.sequenceGap || 0) > 0) summary.bugs.push("SEQUENCE_GAP_ENEBA");
  if ((ej.ResyncRequested || 0) > 1) summary.bugs.push("RESYNC_CASCADE_ENEBA");
  if ((ej.GenerationBumped || 0) > 0) summary.bugs.push("GENERATION_BUMP_SOFTNAV");
  if ((ej.SoftNavObserved || 0) < 2) summary.bugs.push("SOFTNAV_NOT_OBSERVED");

  console.log(
    "ENEBA final",
    JSON.stringify({
      softNavPath,
      addressMiss: summary.eneba.addressMiss,
      sequenceGap: summary.eneba.sequenceGap,
      desyncs: summary.eneba.desyncs,
      journal: ej,
      htmlLen: summary.eneba.htmlLen,
      text: (summary.eneba.text || "").slice(0, 160),
      sessionId: summary.eneba.sessionId,
    }),
  );

  await browser.close();
  await putNav("www.belezanaweb.com.br").catch(() => {});

  fs.writeFileSync(path.join(OUT, `${PREFIX}-net-fails.json`), JSON.stringify(netFails, null, 2));
  fs.writeFileSync(path.join(OUT, `${PREFIX}-summary.json`), JSON.stringify(summary, null, 2));
  console.log("BUGS", JSON.stringify(summary.bugs));
  console.log("DONE", path.join(OUT, `${PREFIX}-summary.json`));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
