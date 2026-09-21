#!/usr/bin/env node
/**
 * Bateria 1–4 (aprofundamento): matar hop asset + click no Live (sem fix).
 *
 *   SPECULUM_LIVE_URL=https://eneba-promocoes.com.br/ node gecko-engine/devpath/_diag-live-battery-14.mjs
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
const WAIT_MS = Number(process.env.DIAG_WAIT_MS || 22000)
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const OUT = path.join(__dirname, 'captures', `live-battery14-${stamp}`)
fs.mkdirSync(OUT, { recursive: true })

const { chromium } = patchright
const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: TARGET.includes('127.0.0.1')
    ? ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights']
    : [],
})
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await context.newPage()

const vstream = {
  created: false,
  url: null,
  framesOut: 0,
  bytesOut: 0,
  framesIn: 0,
  bytesIn: 0,
  outSamples: [],
}
const netLogo = []
const cdpSw = { versions: [], registrations: [] }

page.on('websocket', (ws) => {
  const u = ws.url()
  if (!/vstream/i.test(u)) return
  vstream.created = true
  vstream.url = u.slice(0, 200)
  const m = /sessionId=([0-9a-f-]{36})/i.exec(u)
  if (m) vstream.sessionId = m[1]
  ws.on('framesent', (f) => {
    const n = typeof f.payload === 'string' ? f.payload.length : f.payload?.length || 0
    vstream.framesOut += 1
    vstream.bytesOut += n
    if (vstream.outSamples.length < 40) {
      const b =
        typeof f.payload === 'string'
          ? Buffer.from(f.payload)
          : Buffer.from(f.payload || [])
      vstream.outSamples.push({
        n,
        op: b[0],
        streamId: b.length >= 3 ? b.readUInt16BE(1) : null,
        head: b.subarray(0, Math.min(20, b.length)).toString('hex'),
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
await cdp.send('ServiceWorker.enable').catch(() => null)
cdp.on('Network.requestWillBeSent', (e) => {
  const url = e.request?.url || ''
  if (!/logoFull\.svg|static\.eneba\.games\/branding/i.test(url)) return
  netLogo.push({
    t: 'will',
    requestId: e.requestId,
    url: url.slice(0, 180),
    initiator: e.initiator?.type || null,
    documentURL: (e.documentURL || '').slice(0, 120),
  })
})
cdp.on('Network.responseReceived', (e) => {
  const url = e.response?.url || ''
  if (!/logoFull\.svg|static\.eneba\.games\/branding/i.test(url)) return
  netLogo.push({
    t: 'resp',
    requestId: e.requestId,
    status: e.response.status,
    fromServiceWorker: !!e.response.fromServiceWorker,
    mimeType: e.response.mimeType,
    url: url.slice(0, 180),
  })
})
cdp.on('Network.loadingFailed', (e) => {
  const hit = netLogo.find((x) => x.requestId === e.requestId)
  if (!hit && !/logo|eneba/i.test(e.errorText || '')) return
  netLogo.push({
    t: 'fail',
    requestId: e.requestId,
    errorText: e.errorText,
    canceled: e.canceled,
    type: e.type,
  })
})
cdp.on('ServiceWorker.workerVersionUpdated', (e) => {
  for (const v of e.versions || []) {
    cdpSw.versions.push({
      versionId: v.versionId,
      registrationId: v.registrationId,
      scriptURL: v.scriptURL,
      runningStatus: v.runningStatus,
      status: v.status,
      controlledClients: (v.controlledClients || []).length,
    })
  }
})
cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
  for (const r of e.registrations || []) {
    cdpSw.registrations.push({
      registrationId: r.registrationId,
      scopeURL: r.scopeURL,
      isDeleted: r.isDeleted,
    })
  }
})

await page.addInitScript(() => {
  window.__b14 = {
    assetFetch: [],
    assetReply: [],
    assetTrace: [],
  }
  navigator.serviceWorker?.addEventListener('message', (ev) => {
    const d = ev.data
    if (!d || typeof d !== 'object') return
    if (d.type === 'asset-fetch') {
      window.__b14.assetFetch.push({
        t: performance.now(),
        id: d.id,
        url: String(d.url || '').slice(0, 220),
        dest: d.dest || '',
        range: d.range || '',
        contextId: d.contextId ?? null,
      })
    }
    if (d.type === 'asset') {
      window.__b14.assetReply.push({
        t: performance.now(),
        id: d.id,
        ok: !!d.ok,
        error: d.error || null,
        byteLength: d.bytes ? d.bytes.byteLength || d.bytes.length || 0 : 0,
        contentType: d.contentType || '',
      })
    }
    if (d.type === 'asset-trace') {
      window.__b14.assetTrace.push(d.event || d)
    }
  })
})

const t0 = Date.now()
await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(WAIT_MS)

const b1 = await page.evaluate(async () => {
  if (!window.__b14) {
    window.__b14 = { assetFetch: [], assetReply: [], assetTrace: [] }
  }
  const sw = navigator.serviceWorker.controller
  sw?.postMessage({ type: 'asset-trace-enable', enable: true })

  // Ping SW: token/client + clients.count via MessageChannel echo of state
  let swPing = null
  try {
    const reg = await navigator.serviceWorker.ready
    const active = reg.active
    if (active) {
      swPing = await new Promise((resolve) => {
        const ch = new MessageChannel()
        const timer = setTimeout(() => resolve({ error: 'timeout' }), 1500)
        ch.port1.onmessage = (ev) => {
          clearTimeout(timer)
          resolve(ev.data || { error: 'empty' })
        }
        // asset-sw não tem ping — só prova que active.postMessage não joga
        active.postMessage({ type: 'asset-trace-enable', enable: true }, [ch.port2])
        // Sem handler de reply no SW; marca só que postou
        setTimeout(() => {
          clearTimeout(timer)
          resolve({ posted: true, state: active.state, scriptURL: active.scriptURL })
        }, 200)
      })
    }
  } catch (e) {
    swPing = { error: String(e) }
  }

  const regs = await navigator.serviceWorker.getRegistrations()
  return {
    controller: sw?.scriptURL || null,
    controllerState: sw?.state || null,
    regs: regs.map((r) => ({
      scope: r.scope,
      active: r.active?.state || null,
      waiting: r.waiting?.state || null,
      installing: r.installing?.state || null,
    })),
    fetchSeen: window.__b14.assetFetch.length,
    replySeen: window.__b14.assetReply.length,
    traceSeen: window.__b14.assetTrace.length,
    swPing,
  }
})

// B1b — force logo + Resource Timing (workerStart > 0 ⇒ passou no SW)
const b1Force = await page.evaluate(async () => {
  const beforeF = window.__b14.assetFetch.length
  const beforeR = window.__b14.assetReply.length
  const beforeT = window.__b14.assetTrace.length
  const url = 'https://static.eneba.games/branding/v2/logoFull.svg?b14=' + Date.now()
  performance.clearResourceTimings()
  let fetchResult = null
  try {
    const res = await fetch(url, { cache: 'no-store', mode: 'cors' })
    const buf = await res.arrayBuffer()
    fetchResult = {
      status: res.status,
      statusText: res.statusText,
      ct: res.headers.get('content-type'),
      bytes: buf.byteLength,
      type: res.type,
    }
  } catch (e) {
    fetchResult = { error: String(e), name: e?.name || null }
  }
  await new Promise((r) => setTimeout(r, 1500))
  const entries = performance.getEntriesByType('resource').filter((e) => /logoFull/i.test(e.name))
  const timing = entries.map((e) => ({
    name: e.name.slice(0, 120),
    duration: Math.round(e.duration),
    workerStart: e.workerStart || 0,
    fetchStart: e.fetchStart || 0,
    responseStatus: e.responseStatus ?? null,
    transferSize: e.transferSize ?? null,
    nextHopProtocol: e.nextHopProtocol || null,
  }))
  return {
    fetchResult,
    timing,
    newFetches: window.__b14.assetFetch.slice(beforeF),
    newReplies: window.__b14.assetReply.slice(beforeR),
    newTraces: window.__b14.assetTrace.slice(beforeT),
  }
})

// B1c — mesmo fetch via no-cors (img-like) e via new Image()
const b1ImgPath = await page.evaluate(async () => {
  const url = 'https://static.eneba.games/branding/v2/logoFull.svg?img=' + Date.now()
  const beforeF = window.__b14.assetFetch.length
  const beforeT = window.__b14.assetTrace.length
  let imgResult = null
  await new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      imgResult = { ok: true, nw: img.naturalWidth, nh: img.naturalHeight }
      resolve()
    }
    img.onerror = () => {
      imgResult = { ok: false }
      resolve()
    }
    img.src = url
    setTimeout(() => {
      if (!imgResult) imgResult = { ok: false, timeout: true }
      resolve()
    }, 4000)
  })
  await new Promise((r) => setTimeout(r, 500))
  return {
    imgResult,
    newFetches: window.__b14.assetFetch.slice(beforeF),
    newTraces: window.__b14.assetTrace.slice(beforeT),
  }
})

const b2Imgs = await page.evaluate(() => {
  const iframe = document.querySelector('[data-pp-surface-host] iframe')
  const doc = iframe?.contentDocument
  if (!doc) return { ok: false }
  const imgs = [...doc.images]
  const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0)
  return {
    ok: true,
    total: imgs.length,
    broken: broken.length,
    iframeSrc: iframe.getAttribute('src') || iframe.src || null,
    iframeSrcdocLen: iframe.srcdoc ? iframe.srcdoc.length : 0,
  }
})

// B4 setup: coords + armed probe + real mouse
const clickSetup = await page.evaluate(() => {
  const host = document.querySelector('[data-pp-surface-host]')
  const iframe = host?.querySelector('iframe')
  const doc = iframe?.contentDocument
  if (!doc) return { ok: false, reason: 'no_doc' }
  const btn = [...doc.querySelectorAll('button')].find((b) =>
    /^(Sim|Yes)$/i.test((b.textContent || '').trim()),
  )
  if (!btn) return { ok: false, reason: 'no_sim' }
  const iRect = iframe.getBoundingClientRect()
  const bRect = btn.getBoundingClientRect()
  // coords no viewport da página top
  const cx = iRect.left + bRect.left + Math.max(2, bRect.width / 2)
  const cy = iRect.top + bRect.top + Math.max(2, bRect.height / 2)
  const armedAttr = host?.getAttribute('data-pp-armed') || null
  const surfaceArmed =
    !!host &&
    ([...host.attributes].map((a) => a.name + '=' + a.value).filter((s) => /arm|ready|live/i.test(s)) ||
      [])
  return {
    ok: true,
    cx,
    cy,
    btnW: bRect.width,
    btnH: bRect.height,
    iRect: { l: iRect.left, t: iRect.top, w: iRect.width, h: iRect.height },
    armedAttr,
    surfaceAttrs: surfaceArmed,
    btnText: (btn.textContent || '').trim().slice(0, 20),
  }
})

const outBefore = { frames: vstream.framesOut, bytes: vstream.bytesOut, samples: vstream.outSamples.length }
let b4 = { ok: false, reason: 'no_setup' }
if (clickSetup.ok) {
  // Listener no iframe doc antes do mouse real
  await page.evaluate(() => {
    const iframe = document.querySelector('[data-pp-surface-host] iframe')
    const doc = iframe?.contentDocument
    if (!doc) return
    window.__b14Click = { saw: [], stillSim: null }
    const push = (type) => (ev) => {
      window.__b14Click.saw.push({
        type,
        prevented: ev.defaultPrevented,
        trusted: ev.isTrusted,
        tag: ev.target?.tagName || null,
        pointerType: ev.pointerType || null,
      })
    }
    for (const t of ['pointerdown', 'pointerup', 'click']) {
      doc.addEventListener(t, push(t), true)
    }
  })

  await page.mouse.click(clickSetup.cx, clickSetup.cy, { delay: 40 })
  await page.waitForTimeout(1500)

  b4 = await page.evaluate(() => {
    const iframe = document.querySelector('[data-pp-surface-host] iframe')
    const doc = iframe?.contentDocument
    const stillSim = !!doc &&
      [...doc.querySelectorAll('button')].some((b) =>
        /^(Sim|Yes)$/i.test((b.textContent || '').trim()),
      )
    return {
      ok: true,
      saw: window.__b14Click?.saw || [],
      stillSim,
      textAfter: (doc?.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    }
  })
}

const outAfter = { frames: vstream.framesOut, bytes: vstream.bytesOut, samples: vstream.outSamples.length }
const newOutSamples = vstream.outSamples.slice(outBefore.samples)

await page.screenshot({ path: path.join(OUT, 'surface.png'), fullPage: false })

const report = {
  target: TARGET,
  elapsedMs: Date.now() - t0,
  out: OUT,
  sessionId: vstream.sessionId || null,
  vstream: {
    created: vstream.created,
    framesIn: vstream.framesIn,
    bytesIn: vstream.bytesIn,
    framesOut: vstream.framesOut,
    bytesOut: vstream.bytesOut,
    outSamples: vstream.outSamples,
  },
  cdpSw,
  netLogo,
  battery1_sw: b1,
  battery1_forceLogo: b1Force,
  battery1_imgPath: b1ImgPath,
  battery2_imgs: b2Imgs,
  battery4_setup: clickSetup,
  battery4_click: b4,
  battery4_vstreamDelta: {
    framesOut: outAfter.frames - outBefore.frames,
    bytesOut: outAfter.bytes - outBefore.bytes,
    newOutSamples,
  },
  verdict: {},
}

report.verdict.asset = (() => {
  const fromSw = netLogo.some((x) => x.t === 'resp' && x.fromServiceWorker)
  const timingSw = (b1Force.timing || []).some((t) => (t.workerStart || 0) > 0)
  if (!b1.controller) return 'SW_NOT_CONTROLLING'
  if (fromSw || timingSw) {
    if ((b1Force.newFetches?.length || 0) === 0) return 'SW_INTERCEPTED_BUT_NO_PAGE_MSG'
    if ((b1Force.newReplies?.length || 0) === 0) return 'PAGE_NO_REPLY_TO_SW'
    return 'SW_PATH_ALIVE_CHECK_REPLY'
  }
  if (b1Force.fetchResult?.error && (b1Force.newFetches?.length || 0) === 0) {
    return 'SW_NOT_INTERCEPTING_CROSS_ORIGIN'
  }
  return `ASSET_UNKNOWN`
})()

report.verdict.click = (() => {
  if (!clickSetup.ok) return `CLICK_SETUP:${clickSetup.reason}`
  const delta = outAfter.frames - outBefore.frames
  const trusted = (b4.saw || []).some((s) => s.trusted && s.type === 'pointerdown')
  if (!trusted) return 'MOUSE_NO_TRUSTED_POINTERDOWN'
  if (delta === 0) return 'NO_VSTREAM_OUTBOUND_ON_TRUSTED_CLICK'
  if (b4.stillSim) return `INTENT_WIRE_BUT_NO_VIRTUAL_EFFECT:outFrames=${delta}`
  return `CLICK_EFFECT_OK:outFrames=${delta}`
})()

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(
  JSON.stringify(
    {
      out: OUT,
      sessionId: report.sessionId,
      verdict: report.verdict,
      forceLogo: b1Force.fetchResult,
      timing: b1Force.timing,
      traces: b1Force.newTraces?.slice?.(0, 5),
      imgPath: b1ImgPath,
      netLogo: netLogo.slice(0, 12),
      cdpSwVersions: cdpSw.versions.slice(-5),
      imgsBroken: b2Imgs.broken,
      imgsTotal: b2Imgs.total,
      clickSetup,
      click: {
        stillSim: b4.stillSim,
        saw: b4.saw,
        vstreamDelta: report.battery4_vstreamDelta,
      },
      sw: b1,
    },
    null,
    2,
  ),
)
await browser.close()
