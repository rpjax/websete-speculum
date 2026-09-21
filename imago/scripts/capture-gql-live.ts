/**
 * Pull all GraphQL fixtures from live eneba homepage into a session.
 *   npx tsx scripts/capture-gql-live.ts <sessionId>
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { hashBytes } from '../src/core/hash.js'
import { sessionDir } from '../src/core/store.js'
import { persistedQueryHash } from '../src/shared/fixture.js'
import type { NetworkRecord } from '../src/core/types.js'

const sid = process.argv[2] ?? 'sess-2026-09-03T07-32-44'
const sdir = sessionDir(sid)
const netDir = join(sdir, 'network')

const knownPq = new Set<string>()
let maxReq = 0
for (const f of readdirSync(netDir)) {
  const m = /^req-(\d+)\.json$/.exec(f)
  if (m) maxReq = Math.max(maxReq, Number(m[1]))
  if (!f.endsWith('.json')) continue
  const rec = JSON.parse(readFileSync(join(netDir, f), 'utf8')) as NetworkRecord
  if (rec.persistedQueryHash) knownPq.add(rec.persistedQueryHash)
}

const captured = new Map<string, { reqBody: string; resBuf: Buffer; status: number; ct: string }>()

function writeBlob(buf: Buffer): string {
  const hash = hashBytes(buf)
  const path = join(sdir, 'blobs', hash)
  if (!existsSync(path)) writeFileSync(path, buf)
  return hash
}

function dataKeys(body: Buffer): string {
  try {
    return Object.keys((JSON.parse(body.toString('utf8')) as { data?: Record<string, unknown> }).data ?? {}).join(',')
  } catch { return '?' }
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()

page.on('response', async (res) => {
  const req = res.request()
  if (!req.url().includes('graphql') || req.method() !== 'POST') return
  const reqBody = req.postData()
  if (!reqBody) return
  const pq = persistedQueryHash(Buffer.from(reqBody))
  if (!pq || knownPq.has(pq) || captured.has(pq)) return
  try {
    const resBuf = Buffer.from(await res.body())
    if (res.status() !== 200 || !resBuf.length) return
    captured.set(pq, {
      reqBody,
      resBuf,
      status: res.status(),
      ct: res.headers()['content-type'] ?? 'application/json',
    })
  } catch { /* ignore */ }
})

await page.goto('https://www.eneba.com/br/', { waitUntil: 'networkidle', timeout: 120_000 }).catch(() => undefined)
await page.getByRole('button', { name: /accept all/i }).click({ timeout: 8000 }).catch(() => undefined)
await page.waitForTimeout(10000)
await page.evaluate(() => window.scrollTo(0, 400))
await page.waitForTimeout(3000)
await browser.close()

const added: string[] = []
for (const [pq, hit] of captured) {
  maxReq++
  const reqId = `req-${maxReq}`
  const rec: NetworkRecord = {
    reqId,
    at: new Date().toISOString(),
    method: 'POST',
    url: 'https://graphql.eneba.com/graphql/',
    host: 'graphql.eneba.com',
    resourceType: 'fetch',
    status: hit.status,
    requestHeaders: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(hit.reqBody)) },
    responseHeaders: { 'content-type': hit.ct },
    kind: 'thirdparty',
    requestBodyHash: writeBlob(Buffer.from(hit.reqBody)),
    responseBodyHash: writeBlob(hit.resBuf),
    bytes: hit.resBuf.byteLength,
    persistedQueryHash: pq,
  }
  writeFileSync(join(netDir, `${reqId}.json`), JSON.stringify(rec, null, 2))
  added.push(`${reqId} pq=${pq.slice(0, 16)} keys=${dataKeys(hit.resBuf)}`)
}

console.log(`live captured ${captured.size} new graphql fixtures`)
for (const line of added) console.log(' ', line)

// pq prefixes preview still needs
const need = ['2d2259fc35f5','ff642fee0c4f','8f6983b74dc2','dd6caab6d881','8bd261deb1ff','4b1df802a8f1','608db152efdd','730fa6e0aa17']
for (const prefix of need) {
  const hit = [...knownPq, ...captured.keys()].some((pq) => pq.startsWith(prefix))
  console.log(prefix, hit ? 'COVERED' : 'STILL MISSING')
}
