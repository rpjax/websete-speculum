import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { hashBytes } from '../core/hash.js'
import { sessionDir } from '../core/store.js'
import type { NetworkRecord } from '../core/types.js'
import {
  fixtureKey, graphqlFixtureKeys, graphqlFixtureLookup, isFixtureResponse, persistedQueryHash,
} from './fixture.js'

export interface SessionFixture {
  status: number
  contentType: string
  body: Buffer
  capturedAt: string
}

/** Recorded API fixtures indexed for preview replay and O4b. */
export function indexSessionFixtures(sessionId: string): Map<string, SessionFixture> {
  const dir = join(sessionDir(sessionId), 'network')
  const out = new Map<string, SessionFixture>()
  if (!existsSync(dir)) return out
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const rec = JSON.parse(readFileSync(join(dir, file), 'utf8')) as NetworkRecord
    if (!rec.responseBodyHash || !isFixtureResponse(rec)) continue
    const blob = join(sessionDir(sessionId), 'blobs', rec.responseBodyHash)
    if (!existsSync(blob)) continue
    const fixture: SessionFixture = {
      status: rec.status ?? 200,
      contentType: rec.responseHeaders?.['content-type'] ?? 'application/json',
      body: readFileSync(blob),
      capturedAt: `captured ${rec.at.slice(0, 10)}`,
    }
    out.set(fixtureKey(rec.url, rec.requestBodyHash), fixture)
    if (!rec.requestBodyHash && (rec.method === 'GET' || rec.method === 'HEAD')) {
      out.set(rec.url, fixture)
    }
    if (rec.requestBodyHash) {
      const reqBlob = join(sessionDir(sessionId), 'blobs', rec.requestBodyHash)
      if (existsSync(reqBlob)) {
        const pq = persistedQueryHash(readFileSync(reqBlob))
        if (pq) out.set(`${rec.url}#pq:${pq}`, fixture)
      }
    }
    const pqHeader = rec.persistedQueryHash ?? rec.requestHeaders?.['x-imago-pq']
    if (pqHeader) out.set(`${rec.url}#pq:${pqHeader}`, fixture)
    const len = rec.requestHeaders?.['content-length']
    if (len && rec.method === 'POST') out.set(`${rec.url}#len:${len}`, fixture)
    for (const key of graphqlFixtureKeys(rec.url, fixture.body)) out.set(key, fixture)
  }
  return out
}

export function lookupSessionFixture(
  fixtures: Map<string, SessionFixture>,
  url: string,
  body?: Buffer,
  method = 'GET',
): SessionFixture | undefined {
  if (body?.length) {
    const key = fixtureKey(url, hashBytes(body))
    const hit = fixtures.get(key) ?? fixtures.get(fixtureKey(stripQuery(url), hashBytes(body)))
    if (hit) return hit

    const pq = persistedQueryHash(body)
    if (pq) {
      const pqHit = fixtures.get(`${url}#pq:${pq}`) ?? fixtures.get(`${stripQuery(url)}#pq:${pq}`)
      if (pqHit) return pqHit
    }

    const lenHit = fixtures.get(`${url}#len:${body.length}`) ?? fixtures.get(`${stripQuery(url)}#len:${body.length}`)
    if (lenHit) return lenHit

    const gql = graphqlFixtureLookup(fixtures, url, body) as SessionFixture | undefined
    if (gql) return gql

    if (method !== 'GET' && method !== 'HEAD') return undefined
  }
  return fixtures.get(url) ?? fixtures.get(stripQuery(url))
}

function stripQuery(url: string): string {
  const i = url.indexOf('?')
  return i < 0 ? url : url.slice(0, i)
}
