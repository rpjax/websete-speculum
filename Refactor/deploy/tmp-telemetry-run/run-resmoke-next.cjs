/**
 * Post Fix D/E resmoke: Beleza long settle (no silent FR≫WD) + Eneba SoftNav→PDP.
 * Usage: node run-resmoke-next.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const http = require("http");

const OUT = process.env.OUT_DIR || __dirname;
const BASE = process.env.BASE_URL || "http://127.0.0.1:8080";
const PREFIX = process.env.PREFIX || "nextfix";

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
    const virtualData1x1 = imgs.filter((i) => {
      const s = i.getAttribute("src") || "";
      return s.includes("/w7s/virtual-data/") && i.naturalWidth <= 1;
    }).length;
    const srcsets = [...e.querySelectorAll("[srcset], [imagesrcset]")].map((n) => ({
      tag: n.tagName,
      srcset: (n.getAttribute("srcset") || n.getAttribute("imagesrcset") || "").slice(0, 400),
    }));
    const truncatedAvif = srcsets.filter((s) => /\/f_avif(\s|,|$|\?)/.test(s.srcset)).length;
    const cloudinaryFull = srcsets.filter(
      (s) => /f_avif,q_auto/.test(s.srcset) || /f_avif%2Cq_auto/.test(s.srcset),
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
        });
      }
    }
    return {
      sessionId: window.__speculumSessionId || null,
      href: location.href,
      htmlLen: e.innerHTML.length,
      textLen: text.length,
      text: text.slice(0, 240),
      accessDenied,
      ownedRules,
      brokenImgs,
      imgCount: imgs.length,
      virtualData1x1,
      truncatedAvif,
      cloudinaryFull,
      srcsetSample: srcsets.slice(0, 5),
      desyncs,
      addressMiss: desyncs.filter((d) => d.reason === "address_miss").length,
      sequenceGap: desyncs.filter((d) => d.reason === "sequence_gap").length,
      hops,
      armed: !!hops.client_arm && !hops.client_disarm,
    };
  });
}

async function waitHealthy(page, ms, { allowDeniedClear = true } = {}) {
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
    if (!allowDeniedClear && last.accessDenied && Date.now() - t0 > 5000) break;
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
  const m = await measure(page);
  let sessionId = m.sessionId;
  if (!sessionId) {
    for (let i = front.length - 1; i >= 0; i--) {
      const sid = front[i]?.fields?.sessionId || front[i]?.sessionId;
      if (sid) {
        sessionId = sid;
        break;
      }
    }
  }
  if (sessionId) {
    const exp = await req("GET", `/w7s/api/sessions/${sessionId}/journal-export`);
    if (typeof exp.body === "object") {
      fs.writeFileSync(
        path.join(OUT, `${PREFIX}-${label}-journal-export.json`),
        JSON.stringify(exp.body, null, 2),
      );
    }
  }
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-${label}-measure.json`),
    JSON.stringify({ ...m, sessionId }, null, 2),
  );
  return { sessionId, measure: { ...m, sessionId } };
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
  const silentStall =
    frMax > wdMax + 256 && count("PageProjection.Diff.QueueDropped") === 0 && wdMax > 0;
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
    silentStallForbidden: silentStall,
  };
}

(async () => {
  const since = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, `${PREFIX}-since.txt`), since);
  const netFails = [];
  const summary = { since, beleza: null, eneba: null };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ignoreHTTPSErrors: true,
  });

  // -------- Beleza (long settle to stress wire) --------
  await putNav("www.belezanaweb.com.br");
  const bPage = await context.newPage();
  bPage.on("response", (res) => {
    const u = res.url();
    if (res.status() >= 400 && (u.includes("/w7s/") || u.includes("virtual-"))) {
      netFails.push({ site: "beleza", status: res.status(), url: u.slice(0, 240) });
    }
  });
  console.log("BELEZA goto");
  await bPage.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const beleza = await waitHealthy(bPage, 90000);
  // Long settle: give Diff fan-out time to either keep WD moving or fire QD.
  await sleep(30000);
  const belezaSettled = await measure(bPage);
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-beleza-settled.png`),
    await bPage.screenshot({ fullPage: false }),
  );
  await exportSession(bPage, "beleza");
  summary.beleza = {
    ...belezaSettled,
    waitedMs: beleza.waitedMs,
    sawDenied: beleza.sawDenied,
    journal: journalStats("beleza"),
    truncatedAvifNet: netFails.filter(
      (n) => /f_avif(\s|$|\?)/.test(n.url) && !/q_auto/.test(n.url),
    ).length,
    fAvif404: netFails.filter((n) => n.site === "beleza" && /f_avif/.test(n.url)).length,
  };
  console.log(
    "BELEZA",
    JSON.stringify({
      phase: beleza.phase,
      accessDenied: belezaSettled.accessDenied,
      ownedRules: belezaSettled.ownedRules,
      brokenImgs: belezaSettled.brokenImgs,
      truncatedAvif: belezaSettled.truncatedAvif,
      cloudinaryFull: belezaSettled.cloudinaryFull,
      virtualData1x1: belezaSettled.virtualData1x1,
      addressMiss: belezaSettled.addressMiss,
      journal: summary.beleza.journal,
    }),
  );
  await bPage.close();

  // -------- Eneba SoftNav card→PDP --------
  await putNav("www.eneba.com");
  await sleep(500);
  const ePage = await context.newPage();
  console.log("ENEBA goto");
  await ePage.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const enebaCold = await waitHealthy(ePage, 60000, { allowDeniedClear: false });
  // Let SoftNav locale redirects (/ → /br/) settle before search.
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
    }),
  );

  try {
    const surface = ePage.locator("[data-speculum-dom-surface]");
    for (const t of [
      /Accept/i,
      /Aceitar/i,
      /\bSim\b/,
      /Yes/i,
      /Agree/i,
      /Got it/i,
      /Continuar/i,
      /Continue/i,
    ]) {
      const btn = surface.getByText(t).first();
      if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
        await btn.click({ force: true, timeout: 2000 }).catch(() => {});
        await sleep(400);
      }
    }
  } catch {
    /* */
  }

  // SoftNav: search → PDP (after locale SoftNav has settled).
  await sleep(1000);
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
    // Wait for SoftNav search results URL / content.
    const tSearch = Date.now();
    while (Date.now() - tSearch < 12000) {
      const m = await measure(ePage);
      if (/text=|search|spider/i.test(m.text || "") || (m.htmlLen || 0) > 450000) break;
      await sleep(500);
    }
    await sleep(1500);
    const result = ePage
      .locator("[data-speculum-dom-surface] a")
      .filter({ hasText: /spider.?man|marvel.*spider/i })
      .first();
    if (await result.isVisible({ timeout: 6000 }).catch(() => false)) {
      await result.click({ force: true, timeout: 8000 });
      await sleep(12000);
    } else {
      await ePage
        .locator("[data-speculum-dom-surface] a[href*='steam'][href*='key']")
        .first()
        .click({ force: true, timeout: 8000 });
      await sleep(12000);
    }
  } catch (e) {
    console.warn("search→pdp failed", e.message || e);
  }

  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-eneba-final.png`),
    await ePage.screenshot({ fullPage: false }),
  );
  // Allow fan-out write budget to surface api_fanout_backpressure if WD stalled.
  await sleep(16000);
  const enebaExp = await exportSession(ePage, "eneba");
  summary.eneba = {
    ...enebaExp.measure,
    coldWaitedMs: enebaCold.waitedMs,
    journal: journalStats("eneba"),
  };
  console.log(
    "ENEBA final",
    JSON.stringify({
      addressMiss: summary.eneba.addressMiss,
      sequenceGap: summary.eneba.sequenceGap,
      desyncs: summary.eneba.desyncs,
      journal: summary.eneba.journal,
      htmlLen: summary.eneba.htmlLen,
      ownedRules: summary.eneba.ownedRules,
    }),
  );

  await browser.close();

  // Restore default host
  await putNav("www.belezanaweb.com.br").catch(() => {});

  const accept = {
    belezaNoSilentStall: !summary.beleza?.journal?.silentStallForbidden,
    enebaNoSilentStall: !summary.eneba?.journal?.silentStallForbidden,
    enebaNoAddressMiss: (summary.eneba?.addressMiss || 0) === 0,
    enebaNoGenerationBump: (summary.eneba?.journal?.GenerationBumped || 0) === 0,
    enebaSoftNav: (summary.eneba?.journal?.SoftNavObserved || 0) >= 1,
    // T8: after QD, must OOB ResyncServed (WD>256 alone masks stuck-desync).
    belezaT8Recovered: t8Recovered(summary.beleza?.journal),
    enebaT8Recovered: t8Recovered(summary.eneba?.journal),
  };
  summary.accept = accept;
  fs.writeFileSync(path.join(OUT, `${PREFIX}-net-fails.json`), JSON.stringify(netFails, null, 2));
  fs.writeFileSync(path.join(OUT, `${PREFIX}-summary.json`), JSON.stringify(summary, null, 2));
  console.log("ACCEPT", JSON.stringify(accept));
  console.log("DONE", path.join(OUT, `${PREFIX}-summary.json`));
  if (
    !accept.belezaNoSilentStall ||
    !accept.enebaNoSilentStall ||
    !accept.enebaNoAddressMiss ||
    !accept.belezaT8Recovered ||
    !accept.enebaT8Recovered
  ) {
    process.exitCode = 2;
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

function t8Recovered(j) {
  if (!j) return false;
  if (j.silentStallForbidden) return false;
  const qd = j.QueueDropped || 0;
  if (qd <= 0) {
    // No cut — OK if Diff kept up (no silent FR≫WD already checked).
    return true;
  }
  // Cut observed: OOB joint Resync must land (WD reopen alone is not recovery).
  return (j.ResyncServed || 0) >= 1;
}
