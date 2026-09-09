/**
 * CI/dev helper — fetch live GraphQL for fixtures missing from a closed session.
 * Prefer fixing gaps surfaced by **Run parity** (O4b) in the panel; use this when
 * you already have captured POST bodies on disk from a prior debug session.
 *
 *   npx tsx scripts/ingest-pending-gql.ts <sessionId>
 *
 * Pending bodies dir (legacy): ../debug-ad4d6c-pending/
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashBytes } from '../src/core/hash.js'
import { sessionDir } from '../src/core/store.js'
import { persistedQueryHash } from '../src/shared/fixture.js'
import type { NetworkRecord } from '../src/core/types.js'

const sid = process.argv[2] ?? 'sess-2026-09-03T07-32-44'
const pendingDir = join(process.cwd(), '..', 'debug-ad4d6c-pending')
const sdir = sessionDir(sid)
const netDir = join(sdir, 'network')

if (!existsSync(pendingDir)) {
  console.log('no pending dir — load preview first')
  process.exit(0)
}

const knownPq = new Set<string>()
let maxReq = 0
for (const f of readdirSync(netDir)) {
  const m = /^req-(\d+)\.json$/.exec(f)
  if (m) maxReq = Math.max(maxReq, Number(m[1]))
  if (!f.endsWith('.json')) continue
  const rec = JSON.parse(readFileSync(join(netDir, f), 'utf8')) as NetworkRecord
  if (rec.persistedQueryHash) knownPq.add(rec.persistedQueryHash)
}

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

const added: string[] = []
for (const file of readdirSync(pendingDir)) {
  if (!file.endsWith('.json')) continue
  const reqBody = readFileSync(join(pendingDir, file), 'utf8')
  const pq = persistedQueryHash(Buffer.from(reqBody))
  if (!pq || knownPq.has(pq)) continue

  const res = await fetch('https://graphql.eneba.com/graphql/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': 'https://www.eneba.com',
      'referer': 'https://www.eneba.com/br/',
    },
    body: reqBody,
  })
  const resBuf = Buffer.from(await res.arrayBuffer())
  if (res.status !== 200 || !resBuf.length) {
    console.log('live failed', pq.slice(0, 16), res.status, resBuf.toString('utf8').slice(0, 120))
    continue
  }

  maxReq++
  const reqId = `req-${maxReq}`
  const rec: NetworkRecord = {
    reqId,
    at: new Date().toISOString(),
    method: 'POST',
    url: 'https://graphql.eneba.com/graphql/',
    host: 'graphql.eneba.com',
    resourceType: 'fetch',
    status: res.status,
    requestHeaders: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(reqBody)) },
    responseHeaders: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    kind: 'thirdparty',
    requestBodyHash: writeBlob(Buffer.from(reqBody)),
    responseBodyHash: writeBlob(resBuf),
    bytes: resBuf.byteLength,
    persistedQueryHash: pq,
  }
  writeFileSync(join(netDir, `${reqId}.json`), JSON.stringify(rec, null, 2))
  knownPq.add(pq)
  added.push(`${reqId} pq=${pq.slice(0, 16)} op=${(JSON.parse(reqBody) as { operationName?: string }).operationName ?? '?'} keys=${dataKeys(resBuf)}`)
}

console.log(`ingested ${added.length} fixtures`)
for (const line of added) console.log(' ', line)
