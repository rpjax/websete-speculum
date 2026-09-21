#!/usr/bin/env node
/**
 * Residual Beleza diag — um cold, um dossier, causas dos bugs restantes.
 * Cobre: brokenImgs (AVIF/other hops+MIME+magic+iframe fetch) + CSSOM hash wire×adopted.
 * Não declara Fixed / 1:1.
 *
 *   node gecko-engine/devpath/lab-residual-diag.mjs [url]
 *   WAIT_MS=45000 OUT_DIR=... SPECULUM_ASSET_TRACE=1 node …
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import patchright from '../../sidecar/node_modules/patchright/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PP = path.join(ROOT, 'packages/page-projection/dist');

const { decodeFramePart, FramePartAssembler, PersistentStringTable, peekFrameHeader } = await import(
  pathToFileURL(path.join(PP, 'core/decode.js')).href
);
const { applyFrameToTable } = await import(
  pathToFileURL(path.join(PP, 'core/replicatedTableApply.js')).href
);
const { ReplicatedTable } = await import(pathToFileURL(path.join(PP, 'core/replicatedTable.js')).href);
const { CONTEXT_ID_ROOT } = await import(pathToFileURL(path.join(PP, 'core/frame.js')).href);
const { OpCode } = await import(pathToFileURL(path.join(PP, 'core/opcodes.js')).href);

const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const WAIT_MS = Number(process.env.WAIT_MS || 45000);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
const OUT =
  process.env.OUT_DIR ||
  path.join(ROOT, 'gecko-engine/devpath/captures', `residual-${stamp}`);
fs.mkdirSync(OUT, { recursive: true });

const GECKO_TRACE = process.env.GECKO_ASSET_TRACE || '/tmp/speculum-asset-trace.ndjson';
const PARITY_RULE_MARK = 'noscript{display:none';

function sha16(s) {
  return createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
}
function normCssText(t) {
  return String(t).replace(/\s+/g, ' ').trim();
}
function urlKey(u) {
  return String(u || '').split('?')[0];
}
function parseNdjson(text) {
  const events = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      events.push(JSON.parse(s));
    } catch {
      /* skip */
    }
  }
  return events;
}
function classifyHex(hex) {
  const x = String(hex || '').toLowerCase();
  if (!x) return 'empty';
  if (x.startsWith('1f8b')) return 'gzip';
  if (x.startsWith('7801') || x.startsWith('789c') || x.startsWith('78da')) return 'zlib';
  if (x.startsWith('3c7376') || x.startsWith('3c3f78') || x.startsWith('3c21')) return 'svg_or_xml';
  if (x.startsWith('89504e47')) return 'png';
  if (x.startsWith('ffd8ff')) return 'jpeg';
  if (x.startsWith('474946')) return 'gif';
  if (x.includes('66747970')) {
    if (x.includes('61766966')) return 'avif';
    if (x.includes('68656963') || x.includes('6d696631')) return 'heif';
    return 'isobmff_ftyp';
  }
  if (x.startsWith('52494646') && x.includes('57454250')) return 'webp';
  if (/^[89a-f]/.test(x) && !x.startsWith('89')) return 'likely_brotli_or_encrypted';
  return 'unknown_binary';
}
function formatBucket(url) {
  const u = String(url || '');
  if (/\/f_avif|[?&]f_avif|\.avif\b/i.test(u) || /f_avif,/.test(u)) return 'avif';
  if (/\/f_webp|[?&]f_webp|\.webp\b/i.test(u) || /f_webp,/.test(u)) return 'webp';
  if (/cloudinary/i.test(u)) return 'cloudinary_other';
  if (/pixel|tracking|1x1|spacer/i.test(u)) return 'tracker';
  return 'other';
}
function isTruncatedLeaf(src) {
  if (!src) return true;
  const base = src.split('?')[0].split('#')[0];
  const leaf = base.split('/').pop() || '';
  if (!leaf) return true;
  if (/^f_(avif|webp|jpg|jpeg|png)$/i.test(leaf)) return true;
  return false;
}
function relatedEvents(events, url) {
  const k = urlKey(url);
  return events.filter((e) => {
    const eu = urlKey(e.url || e.u || '');
    if (!eu) return false;
    return eu === k || eu.startsWith(k) || k.startsWith(eu);
  });
}
function startsImageMime(m) {
  return String(m || '')
    .toLowerCase()
    .split(';')[0]
    .trim()
    .startsWith('image/');
}

function trackWireRuleTexts(ops, ruleById) {
  for (const op of ops) {
    if (op.op === OpCode.RuleNew || op.op === OpCode.RuleSet) {
      ruleById.set(op.id, { text: op.text, sheet: op.sheet ?? ruleById.get(op.id)?.sheet ?? 0 });
    } else if (op.op === OpCode.RuleDrop) {
      for (const id of op.ids || []) ruleById.delete(id);
    } else if (op.op === OpCode.SheetDrop) {
      const dropped = new Set(op.ids || []);
      for (const [id, meta] of ruleById) {
        if (dropped.has(meta.sheet)) ruleById.delete(id);
      }
    }
  }
}

function textsFromWire(ruleById) {
  return [...ruleById.values()]
    .map((m) => (typeof m === 'string' ? m : m?.text))
    .filter((t) => typeof t === 'string')
    .map(normCssText)
    .sort();
}

function textsFromAdopted(cssomDump) {
  const texts = [];
  let paritySkipped = 0;
  if (!cssomDump || cssomDump.ok !== true) {
    return { ok: false, reason: cssomDump?.reason || 'missing', texts: [], paritySkipped: 0 };
  }
  for (const e of cssomDump.entries || []) {
    if (!e.adopted) continue;
    if (!Array.isArray(e.rules)) continue;
    for (const t of e.rules) {
      const s = String(t);
      if (s.replace(/\s+/g, '').toLowerCase().includes(PARITY_RULE_MARK.toLowerCase())) {
        paritySkipped++;
        continue;
      }
      texts.push(normCssText(s));
    }
  }
  texts.sort();
  return { ok: true, texts, paritySkipped };
}

/** Multiset diff of sorted rule texts. */
function diffRuleTexts(wireTexts, adoptedTexts) {
  const a = [...wireTexts];
  const b = [...adoptedTexts];
  const onlyWire = [];
  const onlyAdopted = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (a[i] < b[j]) {
      onlyWire.push(a[i++]);
    } else {
      onlyAdopted.push(b[j++]);
    }
  }
  while (i < a.length) onlyWire.push(a[i++]);
  while (j < b.length) onlyAdopted.push(b[j++]);
  return {
    wireCount: wireTexts.length,
    adoptedCount: adoptedTexts.length,
    wireHash16: sha16(wireTexts.join('\n')),
    adoptedHash16: sha16(adoptedTexts.join('\n')),
    hashMatch: sha16(wireTexts.join('\n')) === sha16(adoptedTexts.join('\n')),
    onlyWireCount: onlyWire.length,
    onlyAdoptedCount: onlyAdopted.length,
    onlyWireSample: onlyWire.slice(0, 12).map((t) => t.slice(0, 160)),
    onlyAdoptedSample: onlyAdopted.slice(0, 12).map((t) => t.slice(0, 160)),
  };
}

function classifyBrokenDeep(events, layoutProbe) {
  const byUrl = new Map();
  for (const img of layoutProbe?.imgsSample || []) {
    if (!(img.complete && Number(img.naturalWidth) === 0)) continue;
    const k = urlKey(img.src || img.currentSrc);
    if (k) byUrl.set(k, { ...img, url: k, from: 'layoutSample' });
  }
  for (const e of events) {
    if (e.hop !== 'img.state' || e.event !== 'sameS') continue;
    if (!(e.complete === true && Number(e.naturalWidth) === 0)) continue;
    const k = urlKey(e.url || e.currentSrc);
    if (k && !byUrl.has(k)) byUrl.set(k, { ...e, url: k, from: 'img.state' });
  }

  const formatBuckets = {};
  const reasonBuckets = {};
  const rows = [];

  for (const [url, state] of byUrl) {
    const related = relatedEvents(events, url);
    const hops = {};
    for (const e of related) {
      const key = `${e.hop || '?'}.${e.event || e.phase || e.path || 'x'}`;
      hops[key] = (hops[key] || 0) + 1;
    }
    const intercept = related.find((e) => e.hop === 'sw.intercept');
    const join = related.filter((e) => e.hop === 'gecko.join').at(-1);
    const emit = related.filter((e) => e.hop === 'gecko.emit' && e.phase === 'complete').at(-1);
    const emitDenied = related.find(
      (e) => e.hop === 'gecko.emit' && String(e.phase || e.event || '').includes('denied'),
    );
    const lab = related.filter((e) => e.hop === 'lab.response' && e.phase === 'complete').at(-1);
    const sw = related.filter((e) => e.hop === 'sw.respond').at(-1);
    const teeStop = related.find((e) => e.hop === 'gecko.tee' && e.event === 'tap_stop_ok');
    const teeStart = related.find(
      (e) => e.hop === 'gecko.tee' && (e.event === 'tap_start' || e.event === 'ensure'),
    );
    const decodeFail = related.find((e) => e.hop === 'gecko.tee' && e.event === 'decode_fail');
    const hex = emit?.bodyHeadHex || '';
    const magic = classifyHex(hex);
    const fmt = formatBucket(url);
    formatBuckets[fmt] = (formatBuckets[fmt] || 0) + 1;

    const joinFail =
      join &&
      (join.path === 'open-failed' ||
        join.path === 'denied_open' ||
        join.path === 'denied_pre' ||
        String(join.path || '').includes('fail'));

    let reason = 'unknown';
    if (isTruncatedLeaf(url)) reason = 'src_truncated_leaf';
    else if (!intercept && !emit && !lab && !join) reason = 'no_asset_hops';
    else if (joinFail) reason = `join_${join.path}`;
    else if (emitDenied) reason = 'emit_denied';
    else if (!emit && teeStop) reason = 'tee_ok_no_emit';
    else if (!emit) reason = 'no_gecko_emit';
    else if (Number(emit.dataLen || 0) === 0) reason = 'emit_empty';
    else if (decodeFail) reason = 'tee_decode_fail';
    else if (magic === 'likely_brotli_or_encrypted' || magic === 'gzip' || magic === 'zlib')
      reason = 'emit_still_compressed';
    else if (sw && Number(sw.status) === 502) reason = 'sw_502';
    else if (sw && Number(sw.status) >= 400) reason = `sw_${sw.status}`;
    else if (!startsImageMime(lab?.mimeOut || emit?.mimeOnComplete || emit?.mime))
      reason = `non_image_mime:${lab?.mimeOut || emit?.mimeOnComplete || 'none'}`;
    // Bytes no tee/emit (e/ou fetch no iframe) OK + magic AVIF/WEBP → decoder Projected.
    else if (
      emit &&
      Number(emit.dataLen || 0) > 0 &&
      startsImageMime(emit?.mimeOnComplete || emit?.mime || lab?.mimeOut) &&
      (magic === 'avif' || magic === 'heif' || magic === 'webp' || magic === 'isobmff_ftyp')
    )
      reason = `bytes_ok_browser_decode_fail:${magic === 'isobmff_ftyp' ? 'avif_ftyp' : magic}`;
    else if (
      emit &&
      lab &&
      sw &&
      Number(sw.status) === 200 &&
      emit.bodySha16 &&
      lab.bodySha16 &&
      emit.bodySha16 === lab.bodySha16
    )
      reason = `bytes_ok_browser_decode_fail:${magic}`;
    else reason = `magic_${magic}`;

    reasonBuckets[reason] = (reasonBuckets[reason] || 0) + 1;
    rows.push({
      url: url.slice(0, 260),
      format: fmt,
      reason,
      truncatedLeaf: isTruncatedLeaf(url),
      srcsetHead: String(state.srcset || '').slice(0, 120),
      contentEncoding: teeStart?.contentEncoding || null,
      mime: lab?.mimeOut || emit?.mimeOnComplete || emit?.mime || null,
      dataLen: emit?.dataLen ?? lab?.chunkTotal ?? null,
      bodyHeadHex: hex ? hex.slice(0, 32) : null,
      magic,
      joinPath: join?.path ?? null,
      swStatus: sw?.status ?? null,
      looksLikeImage: sw?.looksLikeImage ?? null,
      hops,
      sha: {
        gecko: emit?.bodySha16 ?? null,
        lab: lab?.bodySha16 ?? null,
        sw: sw?.bodySha16 ?? null,
      },
    });
  }
  rows.sort((a, b) => a.reason.localeCompare(b.reason) || a.url.localeCompare(b.url));
  return {
    brokenCount: rows.length,
    formatBuckets,
    reasonBuckets,
    rows,
  };
}

function hypothesizeCssom(diff, paritySkipped) {
  if (diff.hashMatch) {
    return {
      status: 'ok',
      cause: 'hash_match',
      fixHint: null,
    };
  }
  // Equal counts + large symmetric-only sets → Gecko vs Chromium cssText serialization.
  if (
    diff.wireCount === diff.adoptedCount &&
    diff.onlyWireCount > 0 &&
    diff.onlyAdoptedCount > 0 &&
    Math.abs(diff.onlyWireCount - diff.onlyAdoptedCount) <= 2
  ) {
    return {
      status: 'root_known',
      cause: 'gecko_vs_chromium_csstext_serialization',
      fixHint:
        'Não é regra faltando (counts iguais). Wire (Gecko) vs adopted.cssText (Chromium) expandem border/animation/font-quotes diferente. Iso: normalizar ou comparar contagem/seletores — não hash de cssText cru.',
    };
  }
  if (diff.onlyAdoptedCount === 1 && diff.onlyWireCount === 0 && paritySkipped >= 1) {
    return {
      status: 'root_known',
      cause: 'parity_sheet_rule_not_fully_filtered',
      fixHint: 'Alinhar filtro PARITY_RULE_MARK no digest adopted vs iso assert (ou excluir sheet de paint-parity).',
    };
  }
  if (diff.onlyAdoptedCount > 0 && diff.onlyWireCount === 0) {
    return {
      status: 'root_known',
      cause: 'adopted_has_extra_rules_not_on_wire',
      fixHint: 'Extras no adopted (parity / dual paint / doc sheet leak). Diff onlyAdoptedSample.',
    };
  }
  if (diff.onlyWireCount > 0 && diff.onlyAdoptedCount === 0) {
    return {
      status: 'root_known',
      cause: 'wire_rules_missing_from_adopted',
      fixHint: 'Apply CSSOM incompleto ou texto normalizado diferente no Projected.',
    };
  }
  if (diff.onlyWireCount > 0 && diff.onlyAdoptedCount > 0) {
    return {
      status: 'root_known',
      cause: 'rule_text_content_mismatch',
      fixHint: 'Comparar onlyWireSample vs onlyAdoptedSample (serialização / ordem / whitespace já normalizado).',
    };
  }
  return {
    status: 'needs_more',
    cause: 'hash_mismatch_empty_diff_unexpected',
    fixHint: 'Rever normCssText / sort.',
  };
}

function hypothesizeAssets(broken) {
  const bugs = [];
  const reasons = broken.reasonBuckets || {};
  const formats = broken.formatBuckets || {};

  const trunc = reasons.src_truncated_leaf || 0;
  if (trunc > 0) {
    bugs.push({
      id: 'srcset_truncation',
      status: 'root_known',
      count: trunc,
      cause: 'src_still_truncated_to_f_avif_leaf',
      fixHint: 'Regressão do stampSrcsetAuth / outro rewrite naive de vírgula.',
    });
  }

  const decodeFailKeys = Object.keys(reasons).filter((k) =>
    k.startsWith('bytes_ok_browser_decode_fail'),
  );
  const decodeFail = decodeFailKeys.reduce((n, k) => n + reasons[k], 0);
  if (decodeFail > 0) {
    bugs.push({
      id: 'avif_or_image_decode',
      status: 'root_known',
      count: decodeFail,
      cause: 'pipeline_bytes_ok_but_img_naturalWidth_0',
      fixHint:
        'MIME/tipo no Response, Content-Type AVIF, ou Chromium Projected não decoda o container (ver iframeFetches + magic).',
      reasons: Object.fromEntries(decodeFailKeys.map((k) => [k, reasons[k]])),
    });
  }

  const joinFails = Object.keys(reasons)
    .filter((k) => k.startsWith('join_'))
    .reduce((n, k) => n + reasons[k], 0);
  if (joinFails > 0) {
    bugs.push({
      id: 'asset_join_open',
      status: 'root_known',
      count: joinFails,
      cause: 'gecko_join_open_failed_or_denied',
      fixHint: 'URL Projected ≠ tee Virtual / ensure missing — ver joinPath nas rows.',
    });
  }

  const compressed = reasons.emit_still_compressed || 0;
  if (compressed > 0) {
    bugs.push({
      id: 'emit_compressed',
      status: 'root_known',
      count: compressed,
      cause: 'tee_still_emitting_compressed_body',
      fixHint: 'EnsureLogicalBody / Content-Encoding no caminho desses MIME.',
    });
  }

  const noHops = reasons.no_asset_hops || 0;
  if (noHops > 0) {
    bugs.push({
      id: 'no_hops',
      status: 'needs_more',
      count: noHops,
      cause: 'broken_img_without_sw_or_gecko_hops',
      fixHint: 'Lazy/não fetch, URL não passou pelo SW, ou trace incompleto.',
    });
  }

  const otherFmt = (formats.other || 0) + (formats.tracker || 0) + (formats.cloudinary_other || 0);
  if (otherFmt > 0) {
    bugs.push({
      id: 'other_broken_format',
      status: 'classified_format',
      count: otherFmt,
      cause: 'non_avif_webp_broken_in_sample',
      fixHint: 'Ver rows format=other|tracker — reason por row.',
      formatBuckets: {
        other: formats.other || 0,
        tracker: formats.tracker || 0,
        cloudinary_other: formats.cloudinary_other || 0,
      },
    });
  }

  const covered = new Set([
    'src_truncated_leaf',
    'emit_still_compressed',
    'no_asset_hops',
    ...decodeFailKeys,
    ...Object.keys(reasons).filter((k) => k.startsWith('join_')),
  ]);
  const leftover = Object.entries(reasons).filter(([k]) => !covered.has(k));
  if (leftover.length) {
    bugs.push({
      id: 'asset_other_reasons',
      status: leftover.every(([, n]) => n === 0) ? 'ok' : 'needs_more',
      count: leftover.reduce((n, [, c]) => n + c, 0),
      cause: 'see_reasonBuckets',
      fixHint: 'Abrir rows por reason.',
      reasonBuckets: Object.fromEntries(leftover),
    });
  }

  return bugs;
}

// --- capture ---
const bins = [];
let sameSResult = null;

const { chromium } = patchright;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
cdp.on('Network.webSocketFrameReceived', (params) => {
  const payload = params.response?.payloadData;
  if (!payload) return;
  if (params.response?.opcode === 2) {
    const raw = Buffer.from(payload, 'base64');
    const n = bins.length + 1;
    if (n <= 200) fs.writeFileSync(path.join(OUT, `f-${String(n).padStart(4, '0')}.bin`), raw);
    bins.push(new Uint8Array(raw));
    return;
  }
  if (params.response?.opcode !== 1) return;
  let msg;
  try {
    msg = JSON.parse(payload);
  } catch {
    return;
  }
  if (msg.type === 'lab.sameSResult') {
    sameSResult = msg;
    fs.writeFileSync(path.join(OUT, 'same-s-raw.json'), JSON.stringify(msg));
  }
});

await page.goto(`${LAB}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.click('#connect');
await page.waitForFunction(() => !(document.getElementById('browseStart')?.disabled ?? true), null, {
  timeout: 90000,
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  globalThis.__SPECULUM_ASSET_TRACE = true;
  globalThis.__speculumEnableAssetTraceAll?.();
});
await page.evaluate((url) => {
  const u = document.getElementById('url');
  u.value = url;
  u.dispatchEvent(new Event('input', { bubbles: true }));
}, URL);
await page.click('button:has-text("Start Virtual")');
await page.waitForTimeout(1500);
await page.evaluate(() => {
  globalThis.__SPECULUM_ASSET_TRACE = true;
  globalThis.__speculumEnableAssetTraceAll?.();
});
await page.waitForTimeout(WAIT_MS);
await page.locator('#browseSnap').evaluate((el) => el.click());
const deadline = Date.now() + 25000;
while (!sameSResult && Date.now() < deadline) {
  await page.waitForTimeout(250);
}

const layoutProbe = sameSResult?.projected?.layoutProbe ?? null;
const brokenPreview = (layoutProbe?.imgsSample || [])
  .filter((i) => i.complete && Number(i.naturalWidth) === 0)
  .map((i) => i.src || i.currentSrc)
  .filter(Boolean)
  .slice(0, 5);

let iframeFetches = [];
try {
  iframeFetches = await page.evaluate(async (urls) => {
    const iframe = document.querySelector('#surface iframe, iframe');
    const win = iframe?.contentWindow;
    if (!win) return [{ ok: false, reason: 'no_iframe' }];
    const out = [];
    for (const src of urls) {
      try {
        const res = await win.fetch(src, { credentials: 'omit' });
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf.slice(0, 16));
        const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
        out.push({
          ok: true,
          url: String(src).slice(0, 220),
          status: res.status,
          contentType: res.headers.get('content-type'),
          byteLength: buf.byteLength,
          headHex: hex,
        });
      } catch (e) {
        out.push({
          ok: false,
          url: String(src).slice(0, 220),
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return out;
  }, brokenPreview);
} catch (e) {
  iframeFetches = [{ ok: false, reason: e instanceof Error ? e.message : String(e) }];
}
await browser.close();

const clientEvents = Array.isArray(sameSResult?.projected?.assetTrace)
  ? sameSResult.projected.assetTrace
  : [];
let geckoEvents = [];
try {
  geckoEvents = parseNdjson(fs.readFileSync(GECKO_TRACE, 'utf8'));
  fs.copyFileSync(GECKO_TRACE, path.join(OUT, 'gecko-asset-trace.ndjson'));
} catch {
  geckoEvents = [];
}
const merged = [...clientEvents, ...geckoEvents].sort((a, b) => Number(a.t) - Number(b.t));
fs.writeFileSync(
  path.join(OUT, 'trace.ndjson'),
  merged.map((e) => JSON.stringify(e)).join('\n') + (merged.length ? '\n' : ''),
);

const broken = classifyBrokenDeep(merged, layoutProbe);
for (const row of broken.rows) {
  const hit = iframeFetches.find((f) => urlKey(f.url) === urlKey(row.url));
  if (hit) row.iframeFetch = hit;
}
fs.writeFileSync(path.join(OUT, 'broken-deep.json'), JSON.stringify(broken, null, 2));
fs.writeFileSync(path.join(OUT, 'iframe-fetches.json'), JSON.stringify(iframeFetches, null, 2));

// Wire CSSOM from captured frames
const strings = new PersistentStringTable();
const assembler = new FramePartAssembler();
const table = new ReplicatedTable();
const wireRulesById = new Map();
const rootGens = [];
for (const bytes of bins) {
  const hdr = peekFrameHeader(bytes);
  if (!hdr) continue;
  if (hdr.contextId !== CONTEXT_ID_ROOT && hdr.contextId !== 0) continue;
  rootGens.push(hdr.generation);
}
const targetGen = rootGens.length ? rootGens[rootGens.length - 1] : null;
let firstOfGen = true;
for (const bytes of bins) {
  const hdr = peekFrameHeader(bytes);
  if (!hdr) continue;
  if (hdr.contextId !== CONTEXT_ID_ROOT && hdr.contextId !== 0) continue;
  if (targetGen != null && hdr.generation !== targetGen) continue;
  const decoded = decodeFramePart(bytes, strings);
  if (!decoded.ok) continue;
  const assembled = assembler.ingest(decoded.part);
  if (!assembled || typeof assembled === 'string') continue;
  const forceResync = firstOfGen || assembled.resync;
  firstOfGen = false;
  if (forceResync) wireRulesById.clear();
  applyFrameToTable(table, assembled, { forceResync });
  trackWireRuleTexts(assembled.ops || [], wireRulesById);
}
const wireTexts = textsFromWire(wireRulesById);
const cssomDump = sameSResult?.projected?.cssomSheetDump || null;
const adopted = textsFromAdopted(cssomDump);
const cssomDiff = diffRuleTexts(wireTexts, adopted.texts);
const cssomHyp = hypothesizeCssom(cssomDiff, adopted.paritySkipped);
const cssomReport = {
  ...cssomDiff,
  adoptedOk: adopted.ok,
  adoptedReason: adopted.reason || null,
  paritySkipped: adopted.paritySkipped,
  hypothesis: cssomHyp,
  wireSample: wireTexts.slice(0, 5).map((t) => t.slice(0, 100)),
  adoptedSample: adopted.texts.slice(0, 5).map((t) => t.slice(0, 100)),
  binFrames: bins.length,
  targetGen,
};
fs.writeFileSync(path.join(OUT, 'cssom-diff.json'), JSON.stringify(cssomReport, null, 2));

const assetBugs = hypothesizeAssets(broken);
const bugs = [
  ...assetBugs,
  {
    id: 'cssom_rule_text_hash',
    status: cssomHyp.status,
    cause: cssomHyp.cause,
    fixHint: cssomHyp.fixHint,
    evidence: {
      wireCount: cssomDiff.wireCount,
      adoptedCount: cssomDiff.adoptedCount,
      onlyWireCount: cssomDiff.onlyWireCount,
      onlyAdoptedCount: cssomDiff.onlyAdoptedCount,
      hashMatch: cssomDiff.hashMatch,
      paritySkipped: adopted.paritySkipped,
    },
  },
];

const rootCause = {
  url: URL,
  waitMs: WAIT_MS,
  outDir: OUT,
  sameS: {
    ok: sameSResult?.ok ?? false,
    sameSequence: sameSResult?.sameSequence ?? null,
    virtualSequence: sameSResult?.virtualSequence ?? null,
    projectedSequence: sameSResult?.projectedSequence ?? null,
  },
  layout: {
    brokenImgs: layoutProbe?.brokenImgs ?? null,
    headerH: layoutProbe?.samples?.find?.((s) => s.sel === 'header')?.rect?.h ?? null,
    logoNw:
      layoutProbe?.imgsSample?.find?.((i) => /logo\.svg/i.test(i.src || ''))?.naturalWidth ?? null,
    imgsSampleBroken: (layoutProbe?.imgsSample || []).filter(
      (i) => i.complete && Number(i.naturalWidth) === 0,
    ).length,
  },
  broken: {
    count: broken.brokenCount,
    formatBuckets: broken.formatBuckets,
    reasonBuckets: broken.reasonBuckets,
  },
  cssom: {
    hashMatch: cssomDiff.hashMatch,
    hypothesis: cssomHyp,
    wireCount: cssomDiff.wireCount,
    adoptedCount: cssomDiff.adoptedCount,
    onlyWireCount: cssomDiff.onlyWireCount,
    onlyAdoptedCount: cssomDiff.onlyAdoptedCount,
  },
  bugs,
  nextFixes: bugs
    .filter((b) => b.status === 'root_known' || b.status === 'classified_format')
    .map((b) => ({ id: b.id, fixHint: b.fixHint, cause: b.cause })),
  siteAccept: 'not Fixed — residual diag only',
};
fs.writeFileSync(path.join(OUT, 'root-cause.json'), JSON.stringify(rootCause, null, 2));

let commit = null;
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {
  /* */
}
fs.writeFileSync(
  path.join(OUT, 'MANIFEST.json'),
  JSON.stringify(
    {
      url: URL,
      waitMs: WAIT_MS,
      outDir: OUT,
      commit,
      clientTrace: clientEvents.length,
      geckoTrace: geckoEvents.length,
      bins: bins.length,
    },
    null,
    2,
  ),
);

const summary = {
  ok: false,
  outDir: OUT,
  brokenImgs: layoutProbe?.brokenImgs ?? broken.brokenCount,
  formatBuckets: broken.formatBuckets,
  reasonBuckets: broken.reasonBuckets,
  cssom: rootCause.cssom,
  bugs: bugs.map((b) => ({ id: b.id, status: b.status, cause: b.cause, count: b.count })),
  nextFixes: rootCause.nextFixes,
};
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(2);
