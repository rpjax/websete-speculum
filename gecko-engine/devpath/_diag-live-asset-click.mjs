#!/usr/bin/env node
/**
 * Bateria Live — asset + click (sem fix).
 * Prova hops: SW intercept → hub fetch → bytes; pointer → intent outbound.
 *
 *   SPECULUM_LIVE_URL=http://127.0.0.1:8080/ node gecko-engine/devpath/_diag-live-asset-click.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import patchright from '../../sidecar/node_modules/patchright/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TARGET = (process.env.SPECULUM_LIVE_URL || 'http://127.0.0.1:8080/').replace(/\/?$/, '/')
const WAIT_MS = Number(process.env.DIAG_WAIT_MS || 25000)
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const OUT = path.join(__dirname, 'captures', `live-asset-click-${stamp}`)
fs.mkdirSync(OUT, { recursive: true })

const { chromium } = patchright
const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: [
    '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights',
  ],
})
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  ignoreHTTPSErrors: true,
  serviceWorkers: 'allow',
})
const page = await context.newPage()

const dossier = {
  target: TARGET,
  t0: Date.now(),
  hubInvokes: [],
  swAsset: { fetch: 0, ok: 0, fail: 0, samples: [] },
  imgProbe: null,
  clickProbe: null,
  surface: null,
  sessionId: null,
  console: [],
  pageErrors: [],
}

page.on('console', (m) => {
  const t = m.text()
  if (/asset|intent|sw|gecko|denied|FetchProjected/i.test(t)) {
    dossier.console.push({ type: m.type(), text: t.slice(0, 400) })
  }
})
page.on('pageerror', (e) => dossier.pageErrors.push(String(e).slice(0, 300)))

await page.addInitScript(() => {
  window.__assetClickDiag = {
    swFetch: [],
    swResult: [],
    intentWire: [],
    hubAsset: [],
  }
  // Spy ServiceWorker messages both ways
  const origAdd = navigator.serviceWorker.addEventListener.bind(navigator.serviceWorker)
  navigator.serviceWorker.addEventListener = function (type, listener, opts) {
    if (type === 'message') {
      const wrapped = (ev) => {
        const d = ev.data
        if (d && d.type === 'asset-fetch') {
          window.__assetClickDiag.swFetch.push({
            t: Date.now(),
            url: String(d.url || '').slice(0, 200),
            dest: d.dest,
            id: d.id,
          })
        }
        if (d && d.type === 'asset') {
          window.__assetClickDiag.swResult.push({
            t: Date.now(),
            id: d.id,
            ok: !!d.ok,
            error: d.error || null,
            byteLength: d.bytes ? (d.bytes.byteLength || d.bytes.length || 0) : 0,
            contentType: d.contentType || '',
          })
        }
        return listener(ev)
      }
      return origAdd(type, wrapped, opts)
    }
    return origAdd(type, listener, opts)
  }
})

await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(Math.min(WAIT_MS, 20000))

// Enable SW asset tracing if controller exists
await page.evaluate(async () => {
  const sw = navigator.serviceWorker.controller
  sw?.postMessage({ type: 'asset-trace-enable', enable: true })
})

dossier.surface = await page.evaluate(() => {
  const host = document.querySelector('[data-pp-surface-host]')
  const iframe = host?.querySelector('iframe')
  let textSample = null
  let bodyLen = 0
  let imgStats = { total: 0, complete: 0, natural0: 0, brokenAlt: 0, samples: [] }
  try {
    const doc = iframe?.contentDocument
    textSample = (doc?.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    bodyLen = doc?.body?.innerHTML?.length || 0
    const imgs = [...(doc?.images || [])]
    imgStats.total = imgs.length
    for (const img of imgs.slice(0, 40)) {
      const natural0 = img.complete && img.naturalWidth === 0
      if (img.complete) imgStats.complete += 1
      if (natural0) imgStats.natural0 += 1
      if (/logo|problem displaying/i.test(img.alt || '')) imgStats.brokenAlt += 1
      if (imgStats.samples.length < 12) {
        imgStats.samples.push({
          src: String(img.currentSrc || img.src || '').slice(0, 180),
          complete: img.complete,
          nw: img.naturalWidth,
          nh: img.naturalHeight,
          alt: String(img.alt || '').slice(0, 60),
        })
      }
    }
  } catch (e) {
    return { error: String(e) }
  }
  return {
    host: !!host,
    bodyLen,
    textSample,
    imgStats,
    swController: !!navigator.serviceWorker.controller,
    diag: window.__assetClickDiag,
  }
})

// Force a few image reloads via SW path by reading src of broken imgs
dossier.imgProbe = await page.evaluate(async () => {
  const iframe = document.querySelector('[data-pp-surface-host] iframe')
  const doc = iframe?.contentDocument
  if (!doc) return { ok: false, reason: 'no_doc' }
  const imgs = [...doc.images].filter((i) => i.complete && i.naturalWidth === 0).slice(0, 5)
  const results = []
  for (const img of imgs) {
    const url = img.currentSrc || img.src
    if (!url || url.startsWith('data:')) continue
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
      const buf = await res.arrayBuffer()
      results.push({
        url: url.slice(0, 180),
        status: res.status,
        statusText: res.statusText,
        ct: res.headers.get('content-type'),
        bytes: buf.byteLength,
        viaSw: res.headers.has('cache-control'),
      })
    } catch (e) {
      results.push({ url: url.slice(0, 180), error: String(e).slice(0, 120) })
    }
  }
  return { attempted: imgs.length, results }
})

// Click "Sim" / login / first button in projected surface
dossier.clickProbe = await page.evaluate(async () => {
  const iframe = document.querySelector('[data-pp-surface-host] iframe')
  const doc = iframe?.contentDocument
  const win = iframe?.contentWindow
  if (!doc || !win) return { ok: false, reason: 'no_doc' }

  const before = {
    intentCount: (window.__assetClickDiag?.intentWire || []).length,
    swFetch: (window.__assetClickDiag?.swFetch || []).length,
  }

  // Prefer Brasil "Sim" button, else any button
  const candidates = [
    ...doc.querySelectorAll('button'),
    ...doc.querySelectorAll('[role=button]'),
    ...doc.querySelectorAll('a'),
  ]
  let target = candidates.find((el) => /^(Sim|Yes)$/i.test((el.textContent || '').trim()))
  if (!target) target = candidates.find((el) => (el.textContent || '').trim().length > 0)
  if (!target) return { ok: false, reason: 'no_target', before }

  const rect = target.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2

  // Listen for intents via capturing our own dispatch path: Mutation of capture metrics if exposed
  const events = []
  const note = (type, ev) => {
    events.push({
      type,
      target: (ev.target && ev.target.tagName) || null,
      defaultPrevented: !!ev.defaultPrevented,
    })
  }
  doc.addEventListener('pointerdown', (e) => note('pointerdown', e), true)
  doc.addEventListener('pointerup', (e) => note('pointerup', e), true)
  doc.addEventListener('click', (e) => note('click', e), true)

  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: cx,
      clientY: cy,
      button: 0,
      buttons: 1,
    }),
  )
  target.dispatchEvent(
    new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: cx,
      clientY: cy,
      button: 0,
      buttons: 0,
    }),
  )
  target.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: cx,
      clientY: cy,
      button: 0,
    }),
  )

  await new Promise((r) => setTimeout(r, 800))

  // Did modal disappear / text change?
  const stillSim = [...doc.querySelectorAll('button')].some((b) =>
    /^(Sim|Yes)$/i.test((b.textContent || '').trim()),
  )

  return {
    ok: true,
    targetTag: target.tagName,
    targetText: (target.textContent || '').trim().slice(0, 40),
    rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    events,
    stillSim,
    before,
    afterDiag: window.__assetClickDiag,
  }
})

await page.waitForTimeout(3000)
dossier.surfaceAfterClick = await page.evaluate(() => {
  const iframe = document.querySelector('[data-pp-surface-host] iframe')
  const doc = iframe?.contentDocument
  return {
    textSample: (doc?.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    stillSim: [...(doc?.querySelectorAll('button') || [])].some((b) =>
      /^(Sim|Yes)$/i.test((b.textContent || '').trim()),
    ),
    diag: window.__assetClickDiag,
  }
})

await page.screenshot({ path: path.join(OUT, 'surface.png'), fullPage: false })
fs.writeFileSync(path.join(OUT, 'dossier.json'), JSON.stringify(dossier, null, 2))

const sw = dossier.surface?.diag || dossier.surfaceAfterClick?.diag || {}
const summary = {
  out: OUT,
  bodyLen: dossier.surface?.bodyLen,
  textSample: dossier.surface?.textSample,
  swController: dossier.surface?.swController,
  imgNatural0: dossier.surface?.imgStats?.natural0,
  imgTotal: dossier.surface?.imgStats?.total,
  imgSamples: dossier.surface?.imgStats?.samples?.slice(0, 6),
  forcedFetch: dossier.imgProbe,
  swFetchCount: (sw.swFetch || []).length,
  swResultOk: (sw.swResult || []).filter((r) => r.ok).length,
  swResultFail: (sw.swResult || []).filter((r) => !r.ok).length,
  swResultSamples: (sw.swResult || []).slice(0, 8),
  click: {
    target: dossier.clickProbe?.targetText,
    events: dossier.clickProbe?.events,
    stillSim: dossier.surfaceAfterClick?.stillSim ?? dossier.clickProbe?.stillSim,
  },
}
console.log(JSON.stringify(summary, null, 2))
await browser.close()
