/**
 * Map GraphQL fixtures by persisted-query hash so preview can replay them even
 * when variables/locale change the POST body size.
 *
 *   npx tsx scripts/backfill-gql-pq.ts <sessionId>
 */
import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { sessionDir } from '../src/core/store.js'
import { persistedQueryHash } from '../src/shared/fixture.js'
import type { NetworkRecord } from '../src/core/types.js'

const sid = process.argv[2] ?? 'sess-2026-09-03T07-32-44'
const dir = join(sessionDir(sid), 'network')

function dataKeys(body: Buffer): string {
  try {
    return Object.keys((JSON.parse(body.toString('utf8')) as { data?: Record<string, unknown> }).data ?? {}).sort().join(',')
  } catch { return '' }
}

const byKeys = new Map<string, NetworkRecord>()
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json')) continue
  const rec = JSON.parse(readFileSync(join(dir, f), 'utf8')) as NetworkRecord
  if (!rec.url?.includes('graphql') || !rec.responseBodyHash) continue
  const keys = dataKeys(readFileSync(join(sessionDir(sid), 'blobs', rec.responseBodyHash)))
  if (keys) byKeys.set(keys, rec)
}

const pqToKeys = new Map<string, string>()
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()
page.on('response', async (res) => {
  const req = res.request()
  if (!req.url().includes('graphql') || req.method() !== 'POST') return
  const body = req.postData()
  if (!body) return
  const pq = persistedQueryHash(Buffer.from(body))
  if (!pq) return
  try {
    const buf = Buffer.from(await res.body())
    const keys = dataKeys(buf)
    if (keys) pqToKeys.set(pq, keys)
  } catch { /* ignore */ }
})
await page.goto('https://www.eneba.com/br/', { waitUntil: 'networkidle', timeout: 120_000 }).catch(() => undefined)
await page.waitForTimeout(8000)
await browser.close()

let updated = 0
for (const [pq, keys] of pqToKeys) {
  const rec = byKeys.get(keys)
  if (!rec) {
    console.log('no session match for pq', pq.slice(0, 12), 'keys', keys)
    continue
  }
  const headers = { ...rec.requestHeaders }
  delete headers['x-imago-pq']
  rec.requestHeaders = headers
  rec.persistedQueryHash = pq
  writeFileSync(join(dir, `${rec.reqId}.json`), JSON.stringify(rec, null, 2))
  updated++
  console.log('mapped', rec.reqId, keys, pq.slice(0, 16))
}

console.log(`live pq hashes: ${pqToKeys.size}, updated ${updated}`)
for (const [keys, rec] of byKeys) {
  if (!rec.requestHeaders['x-imago-pq']) console.log('still unmapped', rec.reqId, keys)
}
