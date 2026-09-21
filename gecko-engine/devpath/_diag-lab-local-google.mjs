#!/usr/bin/env node
import patchright from '../../sidecar/node_modules/patchright/index.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'captures', 'lab-local-google.png')
const { chromium } = patchright
const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: [
    '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights',
  ],
})
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto('http://127.0.0.1:4077/', { waitUntil: 'domcontentloaded', timeout: 30000 })

const controls = await page.evaluate(() => ({
  ids: [...document.querySelectorAll('[id]')].map((e) => e.id).slice(0, 40),
  buttons: [...document.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 20),
}))

if (await page.locator('#connect').count()) {
  await page.click('#connect')
  await page.waitForTimeout(2500)
}

for (const sel of ['#url', '#browseUrl', 'input[type=url]', 'input[name=url]']) {
  if (await page.locator(sel).count()) {
    await page.fill(sel, 'https://www.google.com/')
    break
  }
}

for (const sel of ['#start', '#browse', 'button:has-text("Browse")', 'button:has-text("Navigate")', 'button:has-text("Go")']) {
  if (await page.locator(sel).count()) {
    await page.click(sel)
    break
  }
}

await page.waitForTimeout(20000)
const snap = await page.evaluate(() => {
  const host = document.getElementById('surfaceHost') || document.querySelector('[data-pp-surface-host]')
  const iframes = [...(host?.querySelectorAll('iframe') || document.querySelectorAll('iframe'))]
  let best = null
  for (const f of iframes) {
    try {
      const d = f.contentDocument
      const text = (d?.body?.innerText || '').replace(/\s+/g, ' ').trim()
      const bodyLen = d?.body?.innerHTML?.length || 0
      if (!best || bodyLen > (best.bodyLen || 0)) {
        best = {
          bodyLen,
          textLen: text.length,
          textSample: text.slice(0, 120),
          skeleton: !!d?.querySelector('meta[name="speculum-projected-skeleton"]'),
        }
      }
    } catch {
      /* */
    }
  }
  return { iframeCount: iframes.length, best, host: !!host }
})
await page.screenshot({ path: OUT, fullPage: false })
console.log(JSON.stringify({ controls, snap, out: OUT }, null, 2))
await browser.close()
