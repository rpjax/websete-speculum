#!/usr/bin/env node
/**
 * Diag: Beleza homepage card click → DESYNC/RESYNC cascade.
 * Não declara Fixed. Prova = HUD activity + gen/seq antes/depois + telemetria WS.
 *
 *   node gecko-engine/devpath/lab-beleza-click-desync.mjs [url]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import patchright from '../../sidecar/node_modules/patchright/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const COLD_WAIT_MS = Number(process.env.COLD_WAIT_MS || 50000);
const AFTER_CLICK_MS = Number(process.env.AFTER_CLICK_MS || 25000);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
const OUT =
  process.env.OUT_DIR ||
  path.join(ROOT, 'gecko-engine/devpath/captures', `click-desync-${stamp}`);
fs.mkdirSync(OUT, { recursive: true });

function readHud() {
  return {
    frames: document.getElementById('streamFrames')?.textContent?.trim() ?? null,
    generation: document.getElementById('streamGen')?.textContent?.trim() ?? null,
    sequence: document.getElementById('streamSeq')?.textContent?.trim() ?? null,
    applyOk: document.getElementById('streamApply')?.textContent?.trim() ?? null,
    desync: document.getElementById('streamDesync')?.textContent?.trim() ?? null,
    resync: document.getElementById('streamResync')?.textContent?.trim() ?? null,
    ops: document.getElementById('streamOps')?.textContent?.trim() ?? null,
    phase: document.getElementById('chipPhase')?.textContent?.trim() ?? null,
    activityAll: [...document.querySelectorAll('#activity > div')].map((d) => d.textContent || ''),
  };
}

function summarizeActivity(lines) {
  const resyncLines = lines.filter((t) => /resync requested/i.test(t));
  const desyncLines = lines.filter((t) => /\bdesync\b/i.test(t));
  const completed = lines.filter((t) => /resync completed/i.test(t));
  const reasons = {};
  for (const line of resyncLines) {
    const m = /reason=([^\s]+)/i.exec(line);
    const r = m?.[1] || 'unknown';
    reasons[r] = (reasons[r] || 0) + 1;
  }
  const ctxResync = lines.filter((t) => /ctx\d+\s+resync requested/i.test(t));
  const genHints = lines.filter((t) => /generat|install|document\.|nav|blank|nested/i.test(t));
  return {
    resyncRequested: resyncLines.length,
    resyncCompleted: completed.length,
    desyncLines: desyncLines.length,
    reasons,
    resyncLines: resyncLines.slice(0, 40),
    desyncText: desyncLines.slice(0, 40),
    ctxResyncLines: ctxResync.slice(0, 20),
    genNavHints: genHints.slice(0, 30),
  };
}

function surfaceSnapFn() {
  const host = document.getElementById('surfaceHost');
  const iframes = [...(host?.querySelectorAll('iframe') || [])];
  let doc = null;
  for (const f of iframes) {
    try {
      const d = f.contentDocument;
      if (d?.body && (d.body.innerText || '').length > 80) {
        doc = d;
        break;
      }
    } catch {
      /* */
    }
  }
  if (!doc) return { ok: false };
  const bases = [...doc.querySelectorAll('base')].map((b) => b.getAttribute('href') || b.href);
  return {
    ok: true,
    title: doc.title,
    bases,
    h1: (doc.querySelector('h1')?.innerText || '').trim().slice(0, 120),
    bodyStart: (doc.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 280),
    hasKitWella: !!doc.querySelector('a[href*="kit-wella"]'),
    hasAddToCart: /adicionar|comprar|sacola/i.test(doc.body?.innerText || ''),
  };
}

const tele = [];
const activitySnapshots = [];
const { chromium } = patchright;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
cdp.on('Network.webSocketFrameReceived', (params) => {
  const payload = params.response?.payloadData;
  if (!payload || params.response?.opcode !== 1) return;
  let msg;
  try {
    msg = JSON.parse(payload);
  } catch {
    return;
  }
  if (msg.type === 'telemetry' && msg.message) {
    const m = msg.message;
    const kind = m.kind || m.event || null;
    if (
      kind &&
      /desync|resync|apply|generation|document|install|nav|blank|overflow|lag|sequence/i.test(
        String(kind),
      )
    ) {
      tele.push({
        t: Date.now(),
        kind,
        reason: m.reason ?? null,
        generation: m.generation ?? null,
        sequence: m.sequence ?? null,
        contextId: m.contextId ?? null,
        ok: m.ok ?? null,
        message: m.message ?? null,
        expectedSequence: m.expectedSequence ?? null,
        gotSequence: m.gotSequence ?? null,
      });
    }
  }
  if (msg.type === 'session.fault' || msg.type === 'gecko.fault') {
    tele.push({ t: Date.now(), kind: msg.type, message: JSON.stringify(msg).slice(0, 400) });
  }
});

await page.goto(`${LAB}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.click('#connect');
await page.waitForFunction(() => !(document.getElementById('browseStart')?.disabled ?? true), null, {
  timeout: 90000,
});
await page.waitForTimeout(500);
await page.evaluate((url) => {
  const u = document.getElementById('url');
  u.value = url;
  u.dispatchEvent(new Event('input', { bubbles: true }));
}, URL);
await page.click('button:has-text("Start Virtual")');
await page.waitForTimeout(COLD_WAIT_MS);

// Scroll projected surface so product grids enter layout.
await page.evaluate(async () => {
  const host = document.getElementById('surfaceHost');
  const iframes = [...(host?.querySelectorAll('iframe') || document.querySelectorAll('iframe'))];
  let win = null;
  for (const f of iframes) {
    try {
      if (f.contentDocument?.body && (f.contentDocument.body.innerText || '').length > 80) {
        win = f.contentWindow;
        break;
      }
    } catch {
      /* */
    }
  }
  if (!win) return;
  // Product shelves sit mid-page — do not dump into footer (privacy links).
  for (const y of [400, 800, 1200, 1600, 2000]) {
    win.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 350));
  }
  win.scrollTo(0, 1400);
  await new Promise((r) => setTimeout(r, 700));
});
await page.waitForTimeout(2000);

const beforeRaw = await page.evaluate(readHud);
const beforeAct = summarizeActivity(beforeRaw.activityAll);
const before = {
  frames: beforeRaw.frames,
  generation: beforeRaw.generation,
  sequence: beforeRaw.sequence,
  applyOk: beforeRaw.applyOk,
  desync: beforeRaw.desync,
  resync: beforeRaw.resync,
  ops: beforeRaw.ops,
  phase: beforeRaw.phase,
  activityLen: beforeRaw.activityAll.length,
  activitySample: beforeRaw.activityAll.slice(0, 40),
  ...beforeAct,
};
fs.writeFileSync(path.join(OUT, 'hud-before.json'), JSON.stringify(before, null, 2));
const surfaceBefore = await page.evaluate(surfaceSnapFn);

const cardPick = await page.evaluate(() => {
  const host = document.getElementById('surfaceHost');
  const iframes = [...(host?.querySelectorAll('iframe') || document.querySelectorAll('iframe'))];
  let doc = null;
  let iframe = null;
  let win = null;
  for (const f of iframes) {
    try {
      const d = f.contentDocument;
      if (d?.body && (d.body.innerText || '').length > 80) {
        doc = d;
        iframe = f;
        win = f.contentWindow;
        break;
      }
    } catch {
      /* cross-origin */
    }
  }
  if (!doc || !iframe) {
    return { ok: false, reason: 'no_projected_doc', iframeCount: iframes.length };
  }

  const rejectHref = (href) => {
    const h = String(href || '').split('?')[0];
    if (!h || h === '#' || h.startsWith('javascript:')) return true;
    // Only same-site Beleza — external .html (privacy) is noise.
    if (/^https?:\/\//i.test(h) && !/belezanaweb\.com\.br/i.test(h)) return true;
    if (
      /\/(carrinho|sacola|checkout|login|autenticacao|minha-conta|favoritos|atendimento|ofertas\/?$|outlet\/?$|presentes\/?$|ganhe-brindes|cupons|baixe-o-app|alto-luxo|exclusivo|privacidade)/i.test(
        h,
      )
    )
      return true;
    if (/belezanaweb\.com\.br\/?$/i.test(h.replace(/[?#].*$/, ''))) return true;
    return false;
  };

  const productScore = (href, className, text) => {
    const h = String(href || '');
    const path = h.replace(/^https?:\/\/[^/]+/i, '');
    let s = 0;
    // Beleza PDP: long hyphenated slug, often without .html
    if (/^\/[a-z0-9-]{24,}\/?$/i.test(path)) s += 60;
    if (/^\/(kit-[a-z0-9-]{16,})\/?$/i.test(path)) s += 55;
    if (/skinceuticals|bioderma|wella|kerastase|nivea|sebastian|celimax/i.test(path)) s += 25;
    if (/\/p\/|\/produto|product/i.test(h)) s += 40;
    if (/[a-z0-9-]{20,}\/\d{4,}/i.test(h)) s += 30;
    if (/product|sku|card|vitrine|shelf/i.test(className)) s += 20;
    if ((text || '').length > 8) s += 5;
    if (/^\/[a-z0-9-]+\/?$/i.test(path) && path.length < 24) s -= 40;
    if ((path.match(/\//g) || []).length >= 3) s -= 15;
    return s;
  };

  const candidates = [];
  const allLinks = [...doc.querySelectorAll('a[href]')];
  const seen = new Set();
  for (const a of allLinks) {
    const href = a.getAttribute('href') || a.href || '';
    if (rejectHref(href)) continue;
    const r = a.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) continue;
    const className = String(a.className || '');
    const text = (a.innerText || a.getAttribute('aria-label') || '').trim();
    const score = productScore(href, className, text);
    if (score < 10) continue;
    const key = String(href).split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      href: String(href).slice(0, 220),
      text: text.slice(0, 80),
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      tag: a.tagName,
      className: className.slice(0, 100),
      score,
      inView: r.top >= 0 && r.bottom <= (win?.innerHeight || 900) + 80,
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.rect.y - b.rect.y);
  const pick = candidates.find((c) => c.inView) || candidates[0] || null;

  const hrefInventory = {};
  for (const a of allLinks.slice(0, 500)) {
    const h = String(a.getAttribute('href') || '').split('?')[0].slice(0, 100);
    if (!h) continue;
    hrefInventory[h] = (hrefInventory[h] || 0) + 1;
  }

  if (!pick) {
    return {
      ok: false,
      reason: 'no_card_candidate',
      iframeCount: iframes.length,
      bodyTextLen: (doc.body.innerText || '').length,
      scrollY: win?.scrollY ?? null,
      linkCount: allLinks.length,
      hrefInventoryTop: Object.entries(hrefInventory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 40),
      sampleLinks: allLinks.slice(0, 30).map((a) => {
        const r = a.getBoundingClientRect();
        return {
          href: String(a.getAttribute('href') || '').slice(0, 140),
          text: (a.innerText || '').trim().slice(0, 40),
          w: r.width,
          h: r.height,
          y: r.y,
        };
      }),
    };
  }

  try {
    const el = [...doc.querySelectorAll('a[href]')].find((a) =>
      String(a.getAttribute('href') || a.href || '').includes(pick.href.slice(0, 60)),
    );
    el?.scrollIntoView({ block: 'center', inline: 'center' });
  } catch {
    /* */
  }
  const el2 = [...doc.querySelectorAll('a[href]')].find((a) =>
    String(a.getAttribute('href') || a.href || '').includes(pick.href.slice(0, 60)),
  );
  const r2 = el2?.getBoundingClientRect() || pick.rect;
  const ir = iframe.getBoundingClientRect();
  return {
    ok: true,
    href: pick.href,
    text: pick.text,
    className: pick.className,
    score: pick.score,
    rectInDoc: { x: r2.x, y: r2.y, w: r2.width, h: r2.height },
    clickPoint: {
      x: ir.x + r2.x + Math.min(r2.width / 2, 40),
      y: ir.y + r2.y + Math.min(r2.height / 2, 40),
    },
    candidateCount: candidates.length,
    candidatesSample: candidates.slice(0, 12),
    linkCount: allLinks.length,
    scrollY: win?.scrollY ?? null,
    hrefInventoryTop: Object.entries(hrefInventory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25),
    iframeCount: iframes.length,
    nestedIframes: [...doc.querySelectorAll('iframe')].map((f) => ({
      src: String(f.getAttribute('src') || '').slice(0, 120),
      w: f.offsetWidth,
      h: f.offsetHeight,
    })),
  };
});

fs.writeFileSync(path.join(OUT, 'card-pick.json'), JSON.stringify(cardPick, null, 2));

const clickAt = Date.now();
let clickResult = { ok: false, reason: 'skipped' };
if (cardPick.ok && cardPick.href) {
  // Dispatch pointer events inside projected contentDocument so input capture → Virtual.
  // Playwright frameLocator misses when #surfaceHost has empty nested iframes first.
  const dispatched = await page.evaluate((hrefWanted) => {
    const host = document.getElementById('surfaceHost');
    const iframes = [...(host?.querySelectorAll('iframe') || [])];
    let doc = null;
    let iframe = null;
    for (const f of iframes) {
      try {
        const d = f.contentDocument;
        if (d?.body && (d.body.innerText || '').length > 80) {
          doc = d;
          iframe = f;
          break;
        }
      } catch {
        /* */
      }
    }
    if (!doc || !iframe) return { ok: false, reason: 'no_doc' };
    const wantFull = String(hrefWanted).replace(/\/$/, '');
    const wantPath = wantFull.replace(/^https?:\/\/[^/]+/i, '');
    const matches = [...doc.querySelectorAll('a[href]')].filter((a) => {
      const raw = String(a.getAttribute('href') || a.href || '').replace(/\/$/, '');
      const path = raw.replace(/^https?:\/\/[^/]+/i, '');
      if (!wantPath || wantPath === '/') return false;
      return path === wantPath || raw === wantFull;
    });
    const visible = matches
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width >= 20 && x.r.height >= 20)
      .sort((a, b) => a.r.y - b.r.y);
    const picked = visible[0];
    if (!picked) {
      return {
        ok: false,
        reason: 'el_not_visible',
        matchCount: matches.length,
        wantPath,
        sample: matches.slice(0, 5).map((a) => {
          const r = a.getBoundingClientRect();
          return {
            href: String(a.getAttribute('href') || '').slice(0, 120),
            w: r.width,
            h: r.height,
            y: r.y,
          };
        }),
      };
    }
    const el = picked.el;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const ir = iframe.getBoundingClientRect();
    const xLocal = r.x + Math.min(r.width / 2, 40);
    const yLocal = r.y + Math.min(r.height / 2, 40);
    const pageX = ir.x + xLocal;
    const pageY = ir.y + yLocal;
    const common = {
      bubbles: true,
      cancelable: true,
      clientX: xLocal,
      clientY: yLocal,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      buttons: 1,
      button: 0,
      view: doc.defaultView,
    };
    el.dispatchEvent(new PointerEvent('pointerdown', common));
    el.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...common, buttons: 0 }));
    return {
      ok: true,
      href: String(el.getAttribute('href') || el.href || '').slice(0, 220),
      text: (el.innerText || '').trim().slice(0, 80),
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      iframeRect: { x: ir.x, y: ir.y, w: ir.width, h: ir.height },
      client: { x: xLocal, y: yLocal },
      pagePoint: { x: pageX, y: pageY },
      matchCount: matches.length,
      visibleCount: visible.length,
    };
  }, cardPick.href);

  clickResult = {
    ok: !!dispatched?.ok,
    method: 'dispatchPointerInProjected',
    href: cardPick.href,
    text: cardPick.text,
    score: cardPick.score,
    dispatched,
  };

  // Also real mouse at page coords (covers listeners that ignore synthetic events).
  if (dispatched?.ok && dispatched.pagePoint) {
    await page.mouse.click(dispatched.pagePoint.x, dispatched.pagePoint.y);
    clickResult.method = 'dispatchPointer+mouse';
  }
  await page.waitForTimeout(800);
  const intentCheck = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('#activity > div')].map((d) => d.textContent || '');
    return {
      down: lines.filter((t) => /intent down/i.test(t)).slice(0, 8),
      up: lines.filter((t) => /intent up/i.test(t)).slice(0, 8),
      recent: lines.slice(0, 15),
    };
  });
  clickResult = { ...clickResult, intentCheck };
} else {
  clickResult = { ok: false, reason: cardPick.reason || 'no_pick', cardPick };
}
fs.writeFileSync(path.join(OUT, 'click.json'), JSON.stringify(clickResult, null, 2));

// Poll HUD during post-click window (activity buffer is short / newest-first).
const pollUntil = Date.now() + AFTER_CLICK_MS;
while (Date.now() < pollUntil) {
  const snap = await page.evaluate(readHud);
  activitySnapshots.push({
    t: Date.now() - clickAt,
    frames: snap.frames,
    generation: snap.generation,
    sequence: snap.sequence,
    desync: snap.desync,
    resync: snap.resync,
    activity: snap.activityAll.slice(0, 25),
  });
  await page.waitForTimeout(1500);
}

const afterRaw = await page.evaluate(readHud);
const afterAct = summarizeActivity(afterRaw.activityAll);
const polledLines = [];
const seenLine = new Set();
for (const s of activitySnapshots) {
  for (const line of s.activity || []) {
    if (seenLine.has(line)) continue;
    seenLine.add(line);
    polledLines.push(line);
  }
}
const deltaAct = summarizeActivity(
  polledLines.filter((l) => !(before.activitySample || []).includes(l)),
);
const after = {
  frames: afterRaw.frames,
  generation: afterRaw.generation,
  sequence: afterRaw.sequence,
  applyOk: afterRaw.applyOk,
  desync: afterRaw.desync,
  resync: afterRaw.resync,
  ops: afterRaw.ops,
  phase: afterRaw.phase,
  activityLen: afterRaw.activityAll.length,
  activitySample: afterRaw.activityAll.slice(0, 40),
  ...afterAct,
  delta: deltaAct,
  polledActivityUnique: polledLines.slice(0, 80),
};

const surfaceAfterClick = await page.evaluate(surfaceSnapFn);
fs.writeFileSync(
  path.join(OUT, 'surface.json'),
  JSON.stringify({ before: surfaceBefore, afterClick: surfaceAfterClick }, null, 2),
);

// Phase 2 — hard nav control (same product URL) via lab Navigate button.
const productUrl =
  clickResult.href ||
  cardPick.href ||
  'https://www.belezanaweb.com.br/kit-wella-professionals-invigo-nutri-enrich-salon-duo-2-produtos/';
const hardNavAt = Date.now();
const hardNavBeforeHud = await page.evaluate(readHud);
await page.evaluate((url) => {
  const u = document.getElementById('url');
  u.value = url;
  u.dispatchEvent(new Event('input', { bubbles: true }));
}, productUrl);
await page.locator('#browseNavigate').click({ timeout: 10000 }).catch(() => null);
const hardNavPoll = [];
const hardNavUntil = Date.now() + Number(process.env.HARD_NAV_MS || 30000);
while (Date.now() < hardNavUntil) {
  const snap = await page.evaluate(readHud);
  hardNavPoll.push({
    t: Date.now() - hardNavAt,
    frames: snap.frames,
    generation: snap.generation,
    sequence: snap.sequence,
    desync: snap.desync,
    resync: snap.resync,
    activity: snap.activityAll.slice(0, 20),
  });
  await page.waitForTimeout(1500);
}
const hardNavAfterHud = await page.evaluate(readHud);
const surfaceAfterHardNav = await page.evaluate(surfaceSnapFn);
const hardNavActivity = [];
const seenHn = new Set();
for (const s of hardNavPoll) {
  for (const line of s.activity || []) {
    if (seenHn.has(line)) continue;
    seenHn.add(line);
    hardNavActivity.push(line);
  }
}
const hardNavDeltaAct = summarizeActivity(
  hardNavActivity.filter((l) => !(hardNavBeforeHud.activityAll || []).includes(l)),
);
const hardNav = {
  url: productUrl,
  before: {
    frames: hardNavBeforeHud.frames,
    generation: hardNavBeforeHud.generation,
    sequence: hardNavBeforeHud.sequence,
    desync: hardNavBeforeHud.desync,
    resync: hardNavBeforeHud.resync,
  },
  after: {
    frames: hardNavAfterHud.frames,
    generation: hardNavAfterHud.generation,
    sequence: hardNavAfterHud.sequence,
    desync: hardNavAfterHud.desync,
    resync: hardNavAfterHud.resync,
  },
  peakDesync: Math.max(
    Number(hardNavBeforeHud.desync || 0),
    ...hardNavPoll.map((s) => Number(s.desync || 0)),
  ),
  peakResync: Math.max(
    Number(hardNavBeforeHud.resync || 0),
    ...hardNavPoll.map((s) => Number(s.resync || 0)),
  ),
  reasonsDelta: hardNavDeltaAct.reasons,
  activityDelta: hardNavDeltaAct,
  newActivitySample: hardNavActivity
    .filter((l) => !(hardNavBeforeHud.activityAll || []).includes(l))
    .slice(0, 40),
  surface: surfaceAfterHardNav,
};
fs.writeFileSync(path.join(OUT, 'hard-nav.json'), JSON.stringify(hardNav, null, 2));

const teleKinds = {};
for (const e of tele) {
  const k = e.kind || 'unknown';
  teleKinds[k] = (teleKinds[k] || 0) + 1;
}
const telePost = tele.filter((e) => e.t >= clickAt - 500);

const genBefore = before.generation;
const genAfter = after.generation;
const desyncBefore = Number(before.desync || 0);
const desyncAfter = Number(after.desync || 0);
const resyncBefore = Number(before.resync || 0);
const resyncAfter = Number(after.resync || 0);
const peakDesync = Math.max(
  desyncBefore,
  desyncAfter,
  ...activitySnapshots.map((s) => Number(s.desync || 0)),
);
const peakResync = Math.max(
  resyncBefore,
  resyncAfter,
  ...activitySnapshots.map((s) => Number(s.resync || 0)),
);

const clickNavigated =
  surfaceBefore?.ok &&
  surfaceAfterClick?.ok &&
  (surfaceBefore.title !== surfaceAfterClick.title ||
    surfaceBefore.h1 !== surfaceAfterClick.h1 ||
    surfaceBefore.bases?.[0] !== surfaceAfterClick.bases?.[0] ||
    surfaceBefore.bodyStart?.slice(0, 80) !== surfaceAfterClick.bodyStart?.slice(0, 80));

const hypothesis = (() => {
  const hnRise =
    hardNav.peakDesync > Number(hardNav.before.desync || 0) ||
    hardNav.peakResync > Number(hardNav.before.resync || 0) + 1;
  if (hnRise) {
    const r = hardNav.reasonsDelta || {};
    if ((r.sequence_gap || 0) > 0) return 'hard_nav_sequence_gap_cascade';
    if (Object.keys(r).some((k) => /precondition/i.test(k))) return 'hard_nav_precondition_cascade';
    if ((r.lag || 0) > 0) return 'hard_nav_lag_cascade';
    return 'hard_nav_desync_or_resync_rise';
  }
  if (!clickResult.ok) return 'click_failed';
  if (clickResult.intentCheck?.down?.length && !clickNavigated) return 'click_intent_no_navigation';
  const dReasons = deltaAct.reasons || {};
  const hasGap = (dReasons.sequence_gap || 0) > 0;
  const hasLag = (dReasons.lag || 0) > 0;
  const hasPre = Object.keys(dReasons).some((k) => /precondition/i.test(k));
  const genBumped =
    genBefore != null &&
    genAfter != null &&
    genBefore !== '—' &&
    genAfter !== '—' &&
    String(genBefore) !== String(genAfter);
  const desyncRose = peakDesync > desyncBefore;
  const resyncRose = peakResync > resyncBefore;
  if (genBumped && (desyncRose || resyncRose || hasGap || hasPre)) return 'hard_nav_or_generation_bump';
  if (clickNavigated && (desyncRose || resyncRose)) return 'click_nav_with_cascade';
  if (clickNavigated && !desyncRose && !resyncRose) return 'click_nav_clean';
  if (genBumped && !desyncRose && !resyncRose) return 'generation_hud_flicker_or_clean';
  if (hasGap) return 'sequence_gap_post_click';
  if (hasPre) return 'precondition_post_click';
  if (hasLag && !hasGap) return 'lag_only_post_click';
  if (deltaAct.ctxResyncLines?.length) return 'nested_ctx_resync';
  if (desyncRose || resyncRose) return 'desync_or_resync_rise_unclassified';
  return 'no_cascade_observed';
})();

const rootCause = {
  url: URL,
  coldWaitMs: COLD_WAIT_MS,
  afterClickMs: AFTER_CLICK_MS,
  outDir: OUT,
  click: clickResult,
  card: cardPick.ok
    ? {
        href: cardPick.href,
        text: cardPick.text,
        score: cardPick.score,
        candidateCount: cardPick.candidateCount,
        linkCount: cardPick.linkCount,
        scrollY: cardPick.scrollY,
        nestedIframes: cardPick.nestedIframes,
        hrefInventoryTop: cardPick.hrefInventoryTop,
      }
    : cardPick,
  before,
  after,
  surface: {
    before: surfaceBefore,
    afterClick: surfaceAfterClick,
    clickNavigated,
  },
  hardNav,
  poll: {
    samples: activitySnapshots.length,
    peakDesync,
    peakResync,
    genSeries: activitySnapshots.map((s) => s.generation),
    desyncSeries: activitySnapshots.map((s) => s.desync),
    resyncSeries: activitySnapshots.map((s) => s.resync),
  },
  deltas: {
    frames: Number(after.frames || 0) - Number(before.frames || 0),
    desync: desyncAfter - desyncBefore,
    resync: resyncAfter - resyncBefore,
    peakDesyncDelta: peakDesync - desyncBefore,
    peakResyncDelta: peakResync - resyncBefore,
    generationBefore: genBefore,
    generationAfter: genAfter,
    generationChanged: String(genBefore) !== String(genAfter),
    sequenceBefore: before.sequence,
    sequenceAfter: after.sequence,
    reasonsDelta: deltaAct.reasons,
  },
  telemetry: {
    count: tele.length,
    kinds: teleKinds,
    postClick: telePost,
    sample: tele.slice(-80),
  },
  hypothesis,
  contaminatedCold:
    Number(before.resync || 0) > 3 ||
    Number((before.reasons && before.reasons.lag) || 0) > 3 ||
    Number(before.desync || 0) > 0,
  note: 'Não Fixed. Cascata pós-click ≠ lag storm pré-drain (já fechado em b503a799).',
};

fs.writeFileSync(path.join(OUT, 'hud-after.json'), JSON.stringify(after, null, 2));
fs.writeFileSync(path.join(OUT, 'poll.json'), JSON.stringify(activitySnapshots, null, 2));
fs.writeFileSync(path.join(OUT, 'telemetry.json'), JSON.stringify(tele, null, 2));
fs.writeFileSync(path.join(OUT, 'root-cause.json'), JSON.stringify(rootCause, null, 2));
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(rootCause, null, 2));

await browser.close();
console.log(JSON.stringify(rootCause, null, 2));
process.exit(clickResult.ok ? 0 : 2);
