#!/usr/bin/env node
/**
 * Fork objetivo: sessionId / handle ao longo do tempo + no instante do no_session.
 *
 *   SPECULUM_LIVE_URL=https://eneba-promocoes.com.br/ node gecko-engine/devpath/_diag-live-session-handle.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import patchright from '../../sidecar/node_modules/patchright/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TARGET = (process.env.SPECULUM_LIVE_URL || 'https://eneba-promocoes.com.br/').replace(
  /\/?$/,
  '/',
)
const WAIT_MS = Number(process.env.DIAG_WAIT_MS || 20000)
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const OUT = path.join(__dirname, 'captures', `live-handle-${stamp}`)
fs.mkdirSync(OUT, { recursive: true })

const { chromium } = patchright
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await context.newPage()

const logoNet = []
const timeline = []

function installPageHooks() {
  return page.evaluate(() => {
    if (window.__handleInstalled) return { already: true }
    window.__handleInstalled = true
    window.__handleSamples = []
    const snap = (why) => {
      let probe = null
      try {
        probe =
          typeof window.__speculumSessionProbe === 'function'
            ? window.__speculumSessionProbe()
            : null
      } catch (e) {
        probe = { error: String(e) }
      }
      const row = {
        why,
        t: performance.now(),
        sid: window.__speculumSessionId ?? null,
        tok: !!window.__speculumSessionToken,
        probe,
        hasProbe: typeof window.__speculumSessionProbe === 'function',
      }
      window.__handleSamples.push(row)
      return row
    }
    window.__snapHandle = snap
    navigator.serviceWorker.addEventListener('message', (ev) => {
      const d = ev.data
      if (d && d.type === 'asset-fetch') {
        snap('asset-fetch:' + String(d.url || '').slice(0, 100))
      }
    })
    snap('hooks-installed')
    return { already: false }
  })
}

const cdp = await context.newCDPSession(page)
await cdp.send('Network.enable')
cdp.on('Network.responseReceived', (e) => {
  const u = e.response?.url || ''
  if (!/logoFull|static\.eneba\.games\/branding/i.test(u)) return
  logoNet.push({
    t: Date.now(),
    status: e.response.status,
    statusText: e.response.statusText,
    fromSW: !!e.response.fromServiceWorker,
    url: u.slice(0, 140),
    doc: '',
  })
})

const t0 = Date.now()
await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 })
await installPageHooks()

const deadline = Date.now() + WAIT_MS
while (Date.now() < deadline) {
  const row = await page.evaluate(() => {
    const snap =
      typeof window.__snapHandle === 'function'
        ? window.__snapHandle('poll')
        : {
            why: 'poll-no-hooks',
            sid: window.__speculumSessionId ?? null,
            tok: !!window.__speculumSessionToken,
            probe:
              typeof window.__speculumSessionProbe === 'function'
                ? window.__speculumSessionProbe()
                : null,
            hasProbe: typeof window.__speculumSessionProbe === 'function',
          }
    return {
      elapsed: 0,
      sid: snap.sid,
      tok: snap.tok,
      hasProbe: snap.hasProbe,
      probe: snap.probe,
      sampleCount: (window.__handleSamples || []).length,
      lastFetch: [...(window.__handleSamples || [])]
        .reverse()
        .find((s) => String(s.why).startsWith('asset-fetch')),
    }
  })
  row.elapsed = Date.now() - t0
  timeline.push(row)
  await page.waitForTimeout(1000)
}

const forced = await page.evaluate(async () => {
  const before = (window.__handleSamples || []).length
  const url = 'https://static.eneba.games/branding/v2/logoFull.svg?handle=' + Date.now()
  window.__snapHandle?.('before-force')
  const img = await new Promise((resolve) => {
    const i = new Image()
    i.onload = () => resolve({ ok: true, nw: i.naturalWidth })
    i.onerror = () => resolve({ ok: false })
    i.src = url
    setTimeout(() => resolve({ ok: false, timeout: true }), 5000)
  })
  await new Promise((r) => setTimeout(r, 1000))
  const after = (window.__handleSamples || []).slice(before)
  return {
    img,
    after,
    snap: window.__snapHandle?.('after-force') || null,
    allFetches: (window.__handleSamples || []).filter((s) =>
      String(s.why).startsWith('asset-fetch'),
    ),
  }
})

await page.waitForTimeout(400)

const noSession = logoNet.filter((x) => x.fromSW && x.statusText === 'no_session')
const sidEver = timeline.some((r) => !!r.sid)
const sidAtEnd = timeline.length ? timeline[timeline.length - 1].sid : null
const fetchRows = forced.allFetches || []
const fetchWithSid = fetchRows.filter((f) => !!f.sid)
const fetchWithoutSid = fetchRows.filter((f) => !f.sid)

const verdict = (() => {
  if (noSession.length === 0) {
    return { code: 'NO_NO_SESSION', certain: false, detail: 'sem no_session neste run' }
  }
  if (forced.after.some((s) => String(s.why).startsWith('asset-fetch') && s.sid)) {
    return {
      code: 'SID_SET_AT_FETCH_NO_SESSION',
      certain: true,
      meaning:
        'asset-fetch com sessionId set + SW no_session ⇒ sessionRef null (ou fetchRef) com wire ativo.',
    }
  }
  if (forced.after.some((s) => String(s.why).startsWith('asset-fetch') && !s.sid)) {
    return {
      code: 'SID_NULL_AT_FETCH_NO_SESSION',
      certain: true,
      meaning:
        'asset-fetch com sessionId null + reply no_session ⇒ listener wire órfão após clear de sessionId.',
    }
  }
  if (sidEver && !sidAtEnd) {
    return {
      code: 'SID_WAS_SET_THEN_CLEARED',
      certain: true,
      meaning:
        'sessionId existiu e sumiu; no_session continua ⇒ wire sobreviveu ao clear (órfão) ou handle já estava morto antes.',
      sidEver: true,
      sidAtEnd: null,
      noSessionCount: noSession.length,
    }
  }
  if (!sidEver) {
    return {
      code: 'SID_NEVER_SET_BUT_NO_SESSION',
      certain: true,
      meaning:
        'sessionId nunca apareceu no oracle, mas SW devolve no_session ⇒ wire/reply sem sessão UI (órfão de visita anterior ou start nunca commitou sessionId).',
      noSessionCount: noSession.length,
    }
  }
  return {
    code: 'AMBIGUOUS',
    certain: false,
    sidEver,
    sidAtEnd,
    fetchWithSid: fetchWithSid.length,
    fetchWithoutSid: fetchWithoutSid.length,
  }
})()

const report = {
  target: TARGET,
  elapsedMs: Date.now() - t0,
  out: OUT,
  verdict,
  timeline: timeline.map((r) => ({
    elapsed: r.elapsed,
    sid: r.sid,
    tok: r.tok,
    hasProbe: r.hasProbe,
    probe: r.probe,
    sampleCount: r.sampleCount,
    lastFetchSid: r.lastFetch?.sid ?? null,
  })),
  forced,
  noSession,
  fetchWithSid: fetchWithSid.length,
  fetchWithoutSid: fetchWithoutSid.length,
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(
  JSON.stringify(
    {
      out: OUT,
      verdict,
      sidEver,
      sidAtEnd,
      timelineSid: timeline.map((r) => [r.elapsed, r.sid ? r.sid.slice(0, 8) : null]),
      fetchSamples: fetchRows.slice(0, 5),
      noSessionCount: noSession.length,
    },
    null,
    2,
  ),
)
await browser.close()
