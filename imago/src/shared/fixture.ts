/**
 * Which recorded responses are API fixtures — replayed by the preview, never
 * served as static files from the route map.
 */
import type { NetworkRecord } from '../core/types.js'

export function isFixtureResponse(
  rec: Pick<NetworkRecord, 'method' | 'kind' | 'resourceType' | 'responseHeaders'>,
): boolean {
  const ct = (rec.responseHeaders?.['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  const jsonLike = /json|graphql|xml/.test(ct)
  if (rec.kind === 'api') return true
  if (rec.method !== 'GET' && rec.method !== 'HEAD' && jsonLike) return true
  if (rec.kind === 'thirdparty' && jsonLike && (rec.resourceType === 'fetch' || rec.resourceType === 'xhr')) {
    return true
  }
  return false
}

/** Fixture map key: URL alone for GET; URL + request body hash for POST. */
export function fixtureKey(url: string, requestBodyHash?: string): string {
  return requestBodyHash ? `${url}#${requestBodyHash}` : url
}

/** Secondary index for GraphQL fixtures recorded before request bodies were hashed. */
export function graphqlFixtureKeys(url: string, responseBody: Buffer): string[] {
  try {
    const data = (JSON.parse(responseBody.toString('utf8')) as { data?: Record<string, unknown> }).data
    if (!data) return []
    const keys = Object.keys(data).sort()
    const out = [`${url}#gql:${keys.join(',')}`]
    if (keys.length === 1) out.push(`${url}#gql:${keys[0]!}`)
    return out
  } catch { return [] }
}

export function graphqlFixtureLookup(
  fixtures: Map<string, unknown>,
  url: string,
  body: Buffer,
): unknown {
  let parsed: { operationName?: string; query?: string; extensions?: { persistedQuery?: { sha256Hash?: string } } } = {}
  try { parsed = JSON.parse(body.toString('utf8')) as typeof parsed } catch { return undefined }

  const pq = parsed.extensions?.persistedQuery?.sha256Hash
  if (pq) {
    const hit = fixtures.get(`${url}#pq:${pq}`) ?? fixtures.get(`${stripQuery(url)}#pq:${pq}`)
    if (hit) return hit
  }

  const candidates = new Set<string>()
  if (parsed.operationName) {
    candidates.add(parsed.operationName.toLowerCase().replace(/_/g, ''))
  }
  if (parsed.query) {
    for (const m of parsed.query.matchAll(/\{\s*([A-Za-z_][\w]*)/g)) {
      candidates.add(m[1]!.toLowerCase().replace(/_/g, ''))
    }
  }
  if (candidates.size === 0) return undefined

  for (const [key, fix] of fixtures) {
    if (!key.startsWith(`${url}#gql:`) && !key.startsWith(`${stripQuery(url)}#gql:`)) continue
    const dataKey = key.split('#gql:')[1]!.toLowerCase().replace(/_/g, '')
    for (const c of candidates) {
      if (dataKey === c || dataKey.includes(c) || c.includes(dataKey)) return fix
    }
  }
  return undefined
}

export function persistedQueryHash(body: Buffer): string | null {
  try {
    const pq = (JSON.parse(body.toString('utf8')) as { extensions?: { persistedQuery?: { sha256Hash?: string } } })
      .extensions?.persistedQuery?.sha256Hash
    return pq ?? null
  } catch { return null }
}

function stripQuery(u: string): string {
  const i = u.indexOf('?')
  return i < 0 ? u : u.slice(0, i)
}

/** Everything a miss can say about itself, so the panel does not make you guess. */
export interface GraphqlRequestShape {
  isGraphql: boolean
  operationName?: string
  persistedQuery?: string
  /** how many fixtures exist for this URL at all */
  recordedForUrl: number
}

export function describeRequest(
  url: string,
  body: Buffer | undefined,
  fixtures: Map<string, unknown>,
): GraphqlRequestShape {
  let recordedForUrl = 0
  const base = stripQuery(url)
  for (const key of fixtures.keys()) {
    if (key === url || key === base || key.startsWith(`${url}#`) || key.startsWith(`${base}#`)) recordedForUrl++
  }
  if (!body?.length) return { isGraphql: /graphql/i.test(url), recordedForUrl }
  try {
    const parsed = JSON.parse(body.toString('utf8')) as {
      operationName?: string
      query?: string
      extensions?: { persistedQuery?: { sha256Hash?: string } }
    }
    return {
      isGraphql: /graphql/i.test(url) || !!parsed.query || !!parsed.operationName || !!parsed.extensions,
      operationName: parsed.operationName,
      persistedQuery: parsed.extensions?.persistedQuery?.sha256Hash,
      recordedForUrl,
    }
  } catch {
    return { isGraphql: /graphql/i.test(url), recordedForUrl }
  }
}

/**
 * A GraphQL client meeting a 404 with a foreign body does not degrade — it throws,
 * and React unmounts the whole subtree, which is why a bundle can render a complete
 * page and then lose its navigation and hero a moment later.
 *
 * A missing fixture therefore answers in the shape the client expects: a valid
 * GraphQL envelope carrying an error. The application takes its own empty-state
 * path instead of crashing, and the miss is still reported as a miss.
 */
export function graphqlMissBody(shape: GraphqlRequestShape): string {
  const detail = [
    shape.operationName ? `operation ${shape.operationName}` : null,
    shape.persistedQuery ? `pq ${shape.persistedQuery.slice(0, 12)}` : null,
  ].filter(Boolean).join(', ')
  return JSON.stringify({
    data: null,
    errors: [{
      message: `imago: no fixture recorded${detail ? ` for ${detail}` : ''}`,
      extensions: { imago: true },
    }],
  })
}

/**
 * Last resort before reporting a miss: the same operation was recorded, but with
 * different variables. A bundle served from localhost cannot reproduce the region,
 * currency or session the browse had, so variables drift by construction — and a
 * response for the right operation with the wrong variables is far closer to the
 * truth than no response at all. Always labelled, never silent.
 */
export function relaxedGraphqlLookup<T>(
  fixtures: Map<string, T>,
  url: string,
  shape: GraphqlRequestShape,
): { fixture: T; via: string } | undefined {
  const base = stripQuery(url)
  if (shape.persistedQuery) {
    const hit = fixtures.get(`${url}#pq:${shape.persistedQuery}`) ?? fixtures.get(`${base}#pq:${shape.persistedQuery}`)
    if (hit) return { fixture: hit, via: 'persisted query' }
  }
  if (!shape.operationName) return undefined
  const wanted = shape.operationName.toLowerCase().replace(/_/g, '')
  for (const [key, fix] of fixtures) {
    if (!key.startsWith(`${url}#gql:`) && !key.startsWith(`${base}#gql:`)) continue
    const dataKey = key.split('#gql:')[1]!.toLowerCase().replace(/_/g, '')
    if (dataKey === wanted || dataKey.includes(wanted) || wanted.includes(dataKey)) {
      return { fixture: fix, via: 'same operation, different variables' }
    }
  }
  return undefined
}
