#!/usr/bin/env node
/**
 * Validação local do fix (handle + asset + click).
 *   SPECULUM_LIVE_URL=http://127.0.0.1:8080/ node gecko-engine/devpath/_diag-live-fix-validate.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import patchright from '../../sidecar/node_modules/patchright/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TARGET = (process.env.SPECULUM_LIVE_URL || 'http://127.0.0.1:8080/').replace(/\/?$/, '/')
const WAIT_MS = Number(process.env.DIAG_WAIT_MS || 18000)
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const OUT = path.join(__dirname, 'captures', `live-fix-validate-${stamp}`)
fs.mkdirSync(OUT, { recursive: true })

const { chromium } = patchright
const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights'],
})
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await context.newPage()

const vstream = { framesOut: 0, framesIn: 0, bytesIn: 0, sessionId: null, outSamples: [] }
const assetNet = []

page.on('websocket', (ws) => {
  if (!/vstream/i.test(ws.url())) return
  const m = /sessionId=([0-9a-f-]{36})/i.exec(ws.url())
  if (m) vstream.sessionId = m[1]
  ws.on('framesent', (f) => {
    const n = typeof f.payload === 'string' ? f.payload.length : f.payload?.length || 0
    vstream.framesOut += 1
    const b =
      typeof f.payload === 'string' ? Buffer.from(f.payload) : Buffer.from(f.payload || [])
    if (vstream.outSamples.length < 40) {
      vstream.outSamples.push({
        n,
        op: b[0],
        head: b.subarray(0, Math.min(12, b.length)).toString('hex'),
      })
    }
  })
  ws.on('framereceived', (f) => {
    const n = typeof f.payload === 'string' ? f.payload.length : f.payload?.length || 0
    vstream.framesIn += 1
    vstream.bytesIn += n
  })
})

const cdp = await context.newCDPSession(page)
await cdp.send('Network.enable')
cdp.on('Network.responseReceived', (e) => {
  const u = e.response?.url || ''
  if (!/^https?:\/\//i.test(u)) return
  if (new URL(u).origin.includes('127.0.0.1') || new URL(u).origin.includes('localhost')) return
  if (!e.response.fromServiceWorker) return
  assetNet.push({
    status: e.response.status,
    statusText: e.response.statusText,
    url: u.slice(0, 140),
  })
})

const t0 = Date.now()
await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(WAIT_MS)

const mid = await page.evaluate(() => {
  const probe =
    typeof window.__speculumSessionProbe === 'function' ? window.__speculumSessionProbe() : null
  const ds = document.documentElement.dataset
  const iframe = document.querySelector('[data-pp-surface-host] iframe')
  const doc = iframe?.contentDocument
  return {
    probe,
    ds: {
      phase: ds.speculumPhase || null,
      sid: ds.speculumSessionId || null,
      live: ds.speculumLive || null,
      open: ds.speculumOpen || null,
    },
    sid: window.__speculumSessionId ?? null,
    stopType: typeof window.__speculumStopSession,
    hasHost: !!document.querySelector('[data-pp-surface-host]'),
    hasDoc: !!doc,
    imgTotal: doc ? doc.images.length : 0,
    imgBroken: doc
      ? [...doc.images].filter((i) => i.complete && i.naturalWidth === 0).length
      : null,
    text: (doc?.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 100),
  }
})

// Force cross-origin asset (gstatic — típico no Google)
const force = await page.evaluate(async () => {
  const beforeProbe =
    typeof window.__speculumSessionProbe === 'function' ? window.__speculumSessionProbe() : null
  const url = 'https://www.gstatic.com/images/branding/googlelogo/2x/googlelogo_color_92x30dp.png?v=' + Date.now()
  let fetchResult = null
  try {
    const r = await fetch(url, { cache: 'no-store' })
    const buf = await r.arrayBuffer()
    fetchResult = { status: r.status, statusText: r.statusText, bytes: buf.byteLength }
  } catch (e) {
    fetchResult = { error: String(e) }
  }
  const img = await new Promise((resolve) => {
    const i = new Image()
    i.onload = () => resolve({ ok: true, nw: i.naturalWidth })
    i.onerror = () => resolve({ ok: false })
    i.src = url + '&img=1'
    setTimeout(() => resolve({ ok: false, timeout: true }), 5000)
  })
  await new Promise((r) => setTimeout(r, 800))
  return {
    beforeProbe,
    afterProbe:
      typeof window.__speculumSessionProbe === 'function' ? window.__speculumSessionProbe() : null,
    fetchResult,
    img,
  }
})

// Click center of projected surface (trusted)
const outBefore = vstream.framesOut
const clickSetup = await page.evaluate(() => {
  const host = document.querySelector('[data-pp-surface-host]')
  const iframe = host?.querySelector('iframe')
  const doc = iframe?.contentDocument
  if (!iframe || !doc) return { ok: false, reason: 'no_doc' }
  const iRect = iframe.getBoundingClientRect()
  if (iRect.width < 10 || iRect.height < 10) return { ok: false, reason: 'iframe_tiny' }
  const el =
    doc.querySelector('a[href], button, input, [role="button"]') ||
    doc.body ||
    doc.documentElement
  if (!el || typeof el.getBoundingClientRect !== 'function') {
    return {
      ok: true,
      cx: iRect.left + iRect.width / 2,
      cy: iRect.top + iRect.height / 2,
      tag: 'FALLBACK_CENTER',
    }
  }
  const r = el.getBoundingClientRect()
  const cx =
    r.width > 0
      ? iRect.left + Math.max(8, r.left + Math.min(r.width / 2, 40))
      : iRect.left + iRect.width / 2
  const cy =
    r.height > 0
      ? iRect.top + Math.max(8, r.top + Math.min(r.height / 2, 40))
      : iRect.top + iRect.height / 2
  return { ok: true, cx, cy, tag: el.tagName || 'UNKNOWN' }
})
let clickSaw = null
if (clickSetup.ok) {
  await page.evaluate(() => {
    const doc = document.querySelector('[data-pp-surface-host] iframe')?.contentDocument
    window.__clickSaw = []
    if (!doc) return
    for (const t of ['pointerdown', 'pointerup', 'click']) {
      doc.addEventListener(
        t,
        (ev) => {
          window.__clickSaw.push({ type: t, trusted: ev.isTrusted, tag: ev.target?.tagName })
        },
        true,
      )
    }
  })
  await page.mouse.click(clickSetup.cx, clickSetup.cy, { delay: 40 })
  await page.waitForTimeout(1200)
  clickSaw = await page.evaluate(() => window.__clickSaw || [])
}
const outAfter = vstream.framesOut

await page.screenshot({ path: path.join(OUT, 'surface.png'), fullPage: false })

const noSession = assetNet.filter((x) => x.statusText === 'no_session')
const okSw = assetNet.filter((x) => x.status === 200 || x.status === 206)

const verdict = {
  probeAlive:
    (mid.probe?.hasLiveSession === true &&
      mid.probe?.isOpen === true &&
      mid.probe?.phase === 'live') ||
    (mid.ds?.live === '1' && mid.ds?.open === '1' && mid.ds?.phase === 'live'),
  noSessionCount: noSession.length,
  swOkCount: okSw.length,
  forceNoSession: force.fetchResult?.statusText === 'no_session',
  forceFetch: force.fetchResult,
  clickTrusted: (clickSaw || []).some((s) => s.trusted && s.type === 'pointerdown'),
  intentOutDelta: outAfter - outBefore,
  framesIn: vstream.framesIn,
}

verdict.pass =
  verdict.probeAlive &&
  verdict.noSessionCount === 0 &&
  !verdict.forceNoSession &&
  (force.fetchResult?.status === 200 || force.fetchResult?.bytes > 0 || force.img?.ok) &&
  verdict.clickTrusted &&
  verdict.intentOutDelta > 0 &&
  verdict.framesIn > 0

const report = {
  target: TARGET,
  elapsedMs: Date.now() - t0,
  out: OUT,
  sessionId: vstream.sessionId,
  mid,
  force,
  clickSetup,
  clickSaw,
  assetNet: assetNet.slice(0, 20),
  vstreamDelta: { before: outBefore, after: outAfter, samples: vstream.outSamples.slice(-8) },
  verdict,
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ out: OUT, pass: verdict.pass, verdict }, null, 2))
await browser.close()
process.exit(verdict.pass ? 0 : 1)
