import type { PreviewTapeEntry } from '../preview/server.js'
import { indexSessionFixtures } from '../shared/sessionFixtures.js'
import { gapDedupeKey, isParityNoise } from './policy.js'
import type { O4Result, O4bResult, ParityGap, GraphqlMissing } from './types.js'

function parseGraphqlNote(note?: string): { pq?: string; operationName?: string } {
  if (!note) return {}
  const pqMatch = /pq ([a-f0-9]{12})/i.exec(note)
  return { pq: pqMatch?.[1] }
}

function pushGap(gaps: ParityGap[], seen: Set<string>, gap: ParityGap): void {
  const key = `${gap.layer}:${gapDedupeKey(gap.url ?? gap.summary, gap.note)}`
  if (seen.has(key)) return
  seen.add(key)
  gaps.push(gap)
}

export function analyzeO4(tape: PreviewTapeEntry[]): O4Result {
  const gaps: ParityGap[] = []
  const seen = new Set<string>()
  let missing = 0
  let missingAsset = 0
  let blocked = 0
  let fixture = 0
  let ignored = 0

  for (const e of tape) {
    if (e.kind === 'fixture') {
      fixture++
      continue
    }
    if (e.kind !== 'missing' && e.kind !== 'missing-asset' && e.kind !== 'blocked') continue

    if (isParityNoise(e.url)) {
      ignored++
      continue
    }

    if (e.kind === 'missing') {
      missing++
      const isGql = e.url.includes('graphql') || e.note?.includes('pq ')
      pushGap(gaps, seen, {
        layer: isGql ? 'fixture' : 'network',
        summary: e.note ?? 'no fixture recorded',
        url: e.url,
        note: e.note,
      })
    } else if (e.kind === 'missing-asset') {
      missingAsset++
      pushGap(gaps, seen, {
        layer: 'asset',
        summary: 'asset not in bundle',
        url: e.url,
        note: e.note,
      })
    } else if (e.kind === 'blocked') {
      blocked++
      pushGap(gaps, seen, {
        layer: 'blocked',
        summary: e.note ?? 'blocked by preview policy',
        url: e.url,
        note: e.note,
      })
    }
  }

  const pass = missing === 0 && missingAsset === 0 && blocked === 0
  return { pass, missing, missingAsset, blocked, fixture, ignored, gaps }
}

export function analyzeO4b(tape: PreviewTapeEntry[], sessionId: string): O4bResult {
  const fixtures = indexSessionFixtures(sessionId)
  const graphqlMissing: GraphqlMissing[] = []
  const seen = new Set<string>()

  for (const e of tape) {
    if (e.kind !== 'missing') continue
    if (!e.url.includes('graphql') && !e.note?.includes('pq ')) continue
    if (isParityNoise(e.url)) continue
    const { pq } = parseGraphqlNote(e.note)
    const key = pq ?? e.url
    if (seen.has(key)) continue
    seen.add(key)
    if (pq && fixtures.has(`pq:${pq}`)) continue
    graphqlMissing.push({ pq, note: e.note })
  }

  void fixtures

  return { pass: graphqlMissing.length === 0, graphqlMissing }
}

export function rollupGaps(o4: O4Result, o4b: O4bResult): ParityGap[] {
  const gaps = [...o4.gaps]
  const seen = new Set(gaps.map((g) => `${g.layer}:${gapDedupeKey(g.url ?? g.summary, g.note)}`))
  for (const g of o4b.graphqlMissing) {
    const key = `fixture:${g.pq ? `gql:pq:${g.pq}` : g.note ?? 'gql'}`
    if (seen.has(key)) continue
    seen.add(key)
    gaps.push({
      layer: 'fixture',
      summary: g.operationName
        ? `GraphQL ${g.operationName} not in session`
        : `GraphQL fixture missing${g.pq ? ` (pq ${g.pq}…)` : ''}`,
      note: g.note,
    })
  }
  return gaps
}
