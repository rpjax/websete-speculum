#!/usr/bin/env node
/**
 * One-shot Live diag against production (eneba-promocoes).
 * Correlates: sessionId × vstream WS × resync POST × skeleton/armed.
 * Does NOT declare PASS. Does NOT fix.
 *
 *   node gecko-engine/devpath/_diag-live-eneba-vstream.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import patchright from '../../sidecar/node_modules/patchright/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TARGET = (process.env.SPECULUM_LIVE_URL || 'http://127.0.0.1:8080/').replace(
  /\/?$/,
  '/',
)
const WAIT_MS = Number(process.env.DIAG_WAIT_MS || 35000)
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const OUT = path.join(__dirname, 'captures', `live-eneba-vstream-${stamp}`)
fs.mkdirSync(OUT, { recursive: true })

const { chromium } = patchright
const browser = await chromium.launch({
  headless: true,
  channel: process.env.DIAG_BROWSER_CHANNEL || 'chrome',
  args: [
    // Playwright/Chrome 144+ blocks loopback WS (Private Network Access).
    '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights',
    '--disable-private-network-access-respect-preflight-results',
  ],
})
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  ignoreHTTPSErrors: true,
})
const page = await context.newPage()

const wsEvents = []
const httpHits = []
const consoleLines = []
const pageErrors = []

page.on('console', (msg) => {
  consoleLines.push({ t: Date.now(), type: msg.type(), text: msg.text().slice(0, 500) })
})
page.on('pageerror', (err) => {
  pageErrors.push({ t: Date.now(), message: String(err?.message || err).slice(0, 500) })
})

page.on('request', (req) => {
  const url = req.url()
  if (
    /vstream|vhub|page-projection\/resync|client-config|negotiate/i.test(url) ||
    req.resourceType() === 'websocket'
  ) {
    httpHits.push({
      t: Date.now(),
      phase: 'request',
      method: req.method(),
      url: url.slice(0, 400),
      resourceType: req.resourceType(),
    })
  }
})

page.on('response', async (res) => {
  const url = res.url()
  if (/vstream|vhub|page-projection\/resync|client-config|negotiate/i.test(url)) {
    httpHits.push({
      t: Date.now(),
      phase: 'response',
      status: res.status(),
      url: url.slice(0, 400),
    })
  }
})

function decodeMux(payload) {
  let bytes
  if (typeof payload === 'string') {
    bytes = Buffer.from(payload, 'utf8')
  } else if (payload instanceof Buffer) {
    bytes = payload
  } else if (payload && payload.buffer) {
    bytes = Buffer.from(payload)
  } else {
    return { op: null, streamId: null, payloadLen: 0, rawLen: 0 }
  }
  if (bytes.length < 3) {
    return { op: null, streamId: null, payloadLen: 0, rawLen: bytes.length }
  }
  const op = bytes[0]
  const streamId = bytes.readUInt16BE(1)
  return {
    op,
    opName: op === 1 ? 'OPEN' : op === 2 ? 'DATA' : op === 3 ? 'CLOSE' : `op${op}`,
    streamId,
    payloadLen: Math.max(0, bytes.length - 3),
    rawLen: bytes.length,
    pipeKindHint: bytes.length >= 4 && op === 2 ? bytes[3] : null,
  }
}

page.on('websocket', (ws) => {
  const createdAt = Date.now()
  const entry = {
    url: ws.url().slice(0, 500),
    createdAt,
    framesIn: 0,
    framesOut: 0,
    bytesIn: 0,
    muxIn: { OPEN: 0, DATA: 0, CLOSE: 0, other: 0, dataPayloadBytes: 0 },
    muxSamples: [],
    close: null,
  }
  wsEvents.push(entry)
  ws.on('framereceived', (frame) => {
    entry.framesIn += 1
    const decoded = decodeMux(frame.payload)
    entry.bytesIn += decoded.rawLen
    if (decoded.opName === 'OPEN' || decoded.opName === 'DATA' || decoded.opName === 'CLOSE') {
      entry.muxIn[decoded.opName] += 1
      if (decoded.opName === 'DATA') entry.muxIn.dataPayloadBytes += decoded.payloadLen
    } else {
      entry.muxIn.other += 1
    }
    if (entry.muxSamples.length < 40) {
      entry.muxSamples.push({
        t: Date.now() - createdAt,
        ...decoded,
      })
    }
  })
  ws.on('framesent', (frame) => {
    entry.framesOut += 1
    if (entry.muxSamples.length < 40) {
      entry.muxSamples.push({
        t: Date.now() - createdAt,
        dir: 'out',
        ...decodeMux(frame.payload),
      })
    }
  })
  ws.on('close', () => {
    entry.close = { t: Date.now(), ageMs: Date.now() - createdAt }
  })
  ws.on('socketerror', (err) => {
    entry.error = String(err).slice(0, 300)
  })
})

await page.addInitScript(() => {
  window.__speculumDiag = {
    wsConstruct: [],
    wsClose: [],
    wsError: [],
  }
  const Orig = window.WebSocket
  window.WebSocket = function PatchedWebSocket(url, protocols) {
    const u = String(url)
    const rec = {
      url: u.slice(0, 500),
      t: Date.now(),
      readyStates: [{ t: Date.now(), state: 0 }],
    }
    window.__speculumDiag.wsConstruct.push(rec)
    const ws = protocols !== undefined ? new Orig(url, protocols) : new Orig(url)
    const bump = () => {
      rec.readyStates.push({ t: Date.now(), state: ws.readyState })
    }
    ws.addEventListener('open', bump)
    ws.addEventListener('close', (ev) => {
      bump()
      window.__speculumDiag.wsClose.push({
        url: u.slice(0, 500),
        t: Date.now(),
        code: ev.code,
        reason: String(ev.reason || '').slice(0, 200),
        wasClean: ev.wasClean,
      })
    })
    ws.addEventListener('error', () => {
      bump()
      window.__speculumDiag.wsError.push({ url: u.slice(0, 500), t: Date.now() })
    })
    return ws
  }
  window.WebSocket.prototype = Orig.prototype
  Object.assign(window.WebSocket, Orig)
})

const t0 = Date.now()
await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 45000 })

const snapshots = []
const take = async (label) => {
  const snap = await page.evaluate(() => {
    const host = document.querySelector('[data-pp-surface-host]')
    const iframe = host?.querySelector('iframe') || document.querySelector('iframe')
    let srcdocMeta = null
    let bodyLen = null
    let htmlLen = null
    let textLen = null
    let textSample = null
    let title = null
    try {
      const doc = iframe?.contentDocument
      srcdocMeta = doc?.querySelector('meta[name="speculum-projected-skeleton"]')
        ? 'skeleton'
        : doc
          ? 'no-skeleton-meta'
          : null
      bodyLen = doc?.body?.innerHTML?.length ?? null
      htmlLen = doc?.documentElement?.outerHTML?.length ?? null
      const text = (doc?.body?.innerText || '').replace(/\s+/g, ' ').trim()
      textLen = text.length
      textSample = text.slice(0, 120)
      title = iframe?.getAttribute('title') || null
    } catch (e) {
      srcdocMeta = `cross-origin:${String(e).slice(0, 80)}`
    }
    const failedOverlay = !!document.body?.innerText?.includes("isn't available right now")
    return {
      href: location.href,
      hostPresent: !!host,
      hostSize: host
        ? { w: host.clientWidth, h: host.clientHeight }
        : null,
      iframeTitle: title,
      iframeSrcdocLen: iframe?.srcdoc?.length ?? null,
      surface: srcdocMeta,
      bodyLen,
      htmlLen,
      textLen,
      textSample,
      failedOverlay,
      diag: window.__speculumDiag || null,
    }
  })
  snapshots.push({ label, t: Date.now() - t0, ...snap })
  return snap
}

await take('domcontentloaded')
await page.waitForTimeout(Math.min(8000, WAIT_MS))
await take('t+8s')

// Poll remaining window
const deadline = t0 + WAIT_MS
while (Date.now() < deadline) {
  await page.waitForTimeout(2000)
  await take(`t+${Math.round((Date.now() - t0) / 1000)}s`)
}

const finalDiag = await page.evaluate(() => window.__speculumDiag || null)
const screenshot = path.join(OUT, 'surface.png')
await page.screenshot({ path: screenshot, fullPage: false })

// Pull sessionId from resync URL or vstream query
const sessionIds = new Set()
for (const h of httpHits) {
  const m = /sessions\/([0-9a-f-]{36})/i.exec(h.url || '')
  if (m) sessionIds.add(m[1])
  const q = /[?&]sessionId=([0-9a-f-]{36})/i.exec(h.url || '')
  if (q) sessionIds.add(q[1])
}
for (const w of wsEvents) {
  const q = /[?&]sessionId=([0-9a-f-]{36})/i.exec(w.url || '')
  if (q) sessionIds.add(q[1])
}
for (const w of finalDiag?.wsConstruct || []) {
  const q = /[?&]sessionId=([0-9a-f-]{36})/i.exec(w.url || '')
  if (q) sessionIds.add(q[1])
}

  const vstreamWs = wsEvents.filter((w) => /vstream/i.test(w.url))
  const vhubWs = wsEvents.filter((w) => /vhub/i.test(w.url))
  const resync = httpHits.filter((h) => /page-projection\/resync/i.test(h.url || ''))
  const last = snapshots[snapshots.length - 1]
  const muxSummary = vstreamWs.map((w) => ({
    framesIn: w.framesIn,
    bytesIn: w.bytesIn,
    muxIn: w.muxIn,
    samples: w.muxSamples,
    close: w.close,
  }))

  const report = {
    target: TARGET,
    waitMs: WAIT_MS,
    out: OUT,
    sessionIds: [...sessionIds],
    verdictHints: {
      skeletonStill:
        last?.surface === 'skeleton' || (last?.bodyLen != null && last.bodyLen < 40),
      failedOverlay: !!last?.failedOverlay,
      vstreamConstructed: (finalDiag?.wsConstruct || []).some((w) => /vstream/i.test(w.url)),
      vstreamPlaywrightSeen: vstreamWs.length > 0,
      vstreamFramesIn: vstreamWs.reduce((n, w) => n + w.framesIn, 0),
      vstreamDataPayloadBytes: vstreamWs.reduce(
        (n, w) => n + (w.muxIn?.dataPayloadBytes || 0),
        0,
      ),
      vstreamMux: vstreamWs.map((w) => w.muxIn),
      vstreamClosed: vstreamWs.some((w) => w.close),
      vhubSeen: vhubWs.length > 0,
      resyncPosts: resync.filter((h) => h.phase === 'request' && h.method === 'POST').length,
      resyncStatuses: resync.filter((h) => h.phase === 'response').map((h) => h.status),
    },
    muxSummary,
    snapshots,
    wsEvents,
    wsSpy: finalDiag,
    httpHits,
    consoleLines: consoleLines.slice(0, 80),
    pageErrors: pageErrors.slice(0, 40),
  }

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ out: OUT, ...report.verdictHints, sessionIds: report.sessionIds }, null, 2))

await browser.close()
