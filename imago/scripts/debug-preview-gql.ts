/**
 * One-shot: start preview, load homepage, print graphql tape + write debug NDJSON.
 */
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { generateRehost } from '../src/generate/rehost.js'
import { runDir } from '../src/core/store.js'
import { startPreview } from '../src/preview/server.js'

const sid = process.argv[2] ?? 'sess-2026-09-03T07-32-44'
const logPath = join(process.cwd(), '..', 'debug-ad4d6c.log')
const manifest = generateRehost(sid)

const gqlMisses: string[] = []
const gqlHits: string[] = []

const handle = await startPreview({
  runDir: runDir(sid, manifest.runId),
  manifest,
  mode: 'fixtures',
  onTape: (e) => {
    if (!e.url?.includes('graphql')) return
    if (e.kind === 'missing') gqlMisses.push(e.note ?? e.url)
    if (e.kind === 'fixture') gqlHits.push(`${e.status} ${e.note ?? ''}`)
  },
})

appendFileSync(logPath, JSON.stringify({
  sessionId: 'ad4d6c', location: 'debug-preview-gql.ts:start',
  message: 'preview started', data: { url: handle.url, runId: manifest.runId },
  timestamp: Date.now(), hypothesisId: 'H1',
}) + '\n')

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()
await page.goto(handle.url, { waitUntil: 'networkidle', timeout: 120_000 }).catch(() => undefined)
await page.getByRole('button', { name: /accept all/i }).click({ timeout: 5000 }).catch(() => undefined)
await page.waitForTimeout(8000)
await browser.close()
await handle.stop()

appendFileSync(logPath, JSON.stringify({
  sessionId: 'ad4d6c', location: 'debug-preview-gql.ts:done',
  message: 'graphql tape summary',
  data: { hits: gqlHits.length, misses: gqlMisses.length, missNotes: gqlMisses.slice(0, 20), hitSample: gqlHits.slice(0, 10) },
  timestamp: Date.now(), hypothesisId: 'H1',
}) + '\n')

console.log('hits', gqlHits.length, 'misses', gqlMisses.length)
for (const m of gqlMisses.slice(0, 15)) console.log(' MISS', m)
for (const h of gqlHits.slice(0, 8)) console.log(' HIT', h)
