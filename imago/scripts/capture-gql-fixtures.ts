/**
 * Capture GraphQL fixtures the preview needs but the session never recorded.
 * Opens the preview, collects POST bodies that 404, fetches live responses, writes network records.
 *
 *   npx tsx scripts/capture-gql-fixtures.ts <sessionId> <previewUrl>
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { hashBytes } from '../src/core/hash.js'
import { sessionDir } from '../src/core/store.js'
import { persistedQueryHash } from '../src/shared/fixture.js'
import type { NetworkRecord } from '../src/core/types.js'

const sid = process.argv[2] ?? 'sess-2026-09-03T07-32-44'
const previewUrl = process.argv[3] ?? 'http://127.0.0.1:55490/'
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

const pending = new Map<string, string>() // pq → request body
const added: string[] = []

async function fetchLive(body: string): Promise<{ status: number; buf: Buffer; ct: string }> {
  const res = await fetch('https://graphql.eneba.com/graphql/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': 'https://www.eneba.com',
      'referer': 'https://www.eneba.com/br/',
    },
    body,
  })
  const buf = Buffer.from(await res.arrayBuffer())
  return { status: res.status, buf, ct: res.headers.get('content-type') ?? 'application/json' }
}

function writeBlob(buf: Buffer): string {
  const hash = hashBytes(buf)
  const path = join(sdir, 'blobs', hash)
  if (!existsSync(path)) writeFileSync(path, buf)
  return hash
}

function saveRecord(reqBody: string, resBuf: Buffer, status: number, ct: string, pq: string): void {
  maxReq++
  const reqId = `req-${maxReq}`
  const rec: NetworkRecord = {
    reqId,
    at: new Date().toISOString(),
    method: 'POST',
    url: 'https://graphql.eneba.com/graphql/',
    host: 'graphql.eneba.com',
    resourceType: 'fetch',
    status,
    requestHeaders: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(reqBody)) },
    responseHeaders: { 'content-type': ct },
    kind: 'thirdparty',
    requestBodyHash: writeBlob(Buffer.from(reqBody)),
    responseBodyHash: writeBlob(resBuf),
    bytes: resBuf.byteLength,
    persistedQueryHash: pq,
  }
  writeFileSync(join(netDir, `${reqId}.json`), JSON.stringify(rec, null, 2))
  knownPq.add(pq)
  added.push(`${reqId} pq=${pq.slice(0, 16)}… keys=${dataKeys(resBuf)}`)
}

function dataKeys(body: Buffer): string {
  try {
    return Object.keys((JSON.parse(body.toString('utf8')) as { data?: Record<string, unknown> }).data ?? {}).join(',')
  } catch { return '?' }
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()

// Service worker fetch often hides postData from page.on('request') — intercept at route level.
await page.route('**/__imago/api**', async (route) => {
  const req = route.request()
  if (req.method() !== 'POST') {
    await route.continue()
    return
  }
  const u = new URL(req.url()).searchParams.get('u') ?? ''
  if (!u.includes('graphql')) {
    await route.continue()
    return
  }
  const body = req.postData() ?? ''
  const pq = body ? persistedQueryHash(Buffer.from(body)) : null
  const res = await route.fetch()
  if (pq && !knownPq.has(pq) && res.status() === 404) pending.set(pq, body)
  await route.fulfill({ response: res })
})

page.on('request', (req) => {
  if (req.method() !== 'POST' || !req.url().includes('__imago/api')) return
  const u = new URL(req.url()).searchParams.get('u') ?? ''
  if (!u.includes('graphql')) return
  const body = req.postData()
  if (!body) return
  const pq = persistedQueryHash(Buffer.from(body))
  if (!pq || knownPq.has(pq)) return
  pending.set(pq, body)
})

page.on('response', async (res) => {
  const req = res.request()
  if (req.method() !== 'POST' || !req.url().includes('__imago/api')) return
  const u = new URL(req.url()).searchParams.get('u') ?? ''
  if (!u.includes('graphql')) return
  const body = req.postData()
  if (!body) return
  const pq = persistedQueryHash(Buffer.from(body))
  if (!pq || knownPq.has(pq)) return
  if (res.status() !== 404) return
  pending.set(pq, body)
})

await page.goto(previewUrl, { waitUntil: 'networkidle', timeout: 120_000 }).catch(() => undefined)
await page.getByRole('button', { name: /accept all/i }).click({ timeout: 5000 }).catch(() => undefined)
await page.waitForTimeout(6000)

await browser.close()

console.log(`pending ${pending.size} graphql pq hashes to fetch from live`)
for (const [pq, body] of pending) {
  if (knownPq.has(pq)) continue
  try {
    const live = await fetchLive(body)
    if (live.status !== 200 || !live.buf.length) {
      console.log('live fetch failed', pq.slice(0, 16), live.status)
      continue
    }
    saveRecord(body, live.buf, live.status, live.ct, pq)
  } catch (e) {
    console.log('live fetch error', pq.slice(0, 16), String(e).slice(0, 80))
  }
}

console.log(`added ${added.length} fixtures:`)
for (const line of added) console.log(' ', line)
