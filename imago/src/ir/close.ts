import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { readMeta, sessionDir, writeMeta } from '../core/store.js'
import type { NetworkRecord, SnapshotRecord } from '../core/types.js'

/** Bumped whenever the report's shape changes. Old reports are refused, not read. */
export const CLOSURE_SCHEMA = 1

export interface CloseReport {
  schema: number
  sessionId: string
  snapshots: number
  requests: number
  assets: number
  styles: number
  trees: number
  /** references the resolver fetched at close, that the page itself never requested */
  resolved: number
  /** C-4: still missing after resolution. A generator refuses to run on these (E5). */
  unresolved: { url: string; reason: string }[]
  /** the same, grouped — 591 lines is not a report */
  unresolvedByHost: { host: string; count: number }[]
  errors: number
  status: string
}

const EXT_BY_TYPE: Record<string, string> = {
  'text/css': '.css', 'text/html': '.html', 'application/javascript': '.js', 'text/javascript': '.js',
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/svg+xml': '.svg',
  'image/webp': '.webp', 'image/avif': '.avif', 'font/woff2': '.woff2', 'font/woff': '.woff',
  'application/json': '.json',
}

/**
 * Promote a recorded session to the IR layout (ir.md §1) and run the closure
 * check. Promotion is a copy of already content-addressed bytes — never a re-hash,
 * so hashes written during recording stay the hashes on disk (IR-1).
 */
export function finalize(sessionId: string): CloseReport {
  const dir = sessionDir(sessionId)
  const meta = readMeta(sessionId)
  if (!meta) throw new Error(`unknown session ${sessionId}`)
  // A session recovered from a crash may be missing whole directories. Finalizing
  // is expected to work on a partial session — that is what recovery is for.
  for (const sub of ['snapshots', 'network', 'trees', 'styles', 'assets']) {
    mkdirSync(join(dir, sub), { recursive: true })
  }

  const snapshots = readJsonDir<SnapshotRecord>(join(dir, 'snapshots'))
  const network = readJsonDir<NetworkRecord>(join(dir, 'network'))

  // styles: sheet blobs → styles/<hash>.css
  let styleCount = 0
  for (const snap of snapshots) {
    for (const hash of snap.styles) {
      const from = join(dir, 'blobs', hash)
      const to = join(dir, 'styles', `${hash}.css`)
      if (existsSync(from) && !existsSync(to)) { copyFileSync(from, to); styleCount++ }
    }
  }

  // assets: response bodies → assets/<hash><ext>
  let assetCount = 0
  let resolved = 0
  const fetched = new Set<string>()
  const failure = new Map<string, string>()
  for (const rec of network) {
    // A 404 is not "fetched". Counting every attempt as success is how a closure
    // check reports green while the bundle is missing bytes.
    const ok = !!rec.responseBodyHash || (rec.status !== undefined && rec.status >= 200 && rec.status < 400)
    if (ok) {
      fetched.add(rec.url)
      if (rec.resolvedAtClose && rec.responseBodyHash) resolved++
    } else {
      failure.set(rec.url, rec.error ?? (rec.status ? `status ${rec.status}` : 'failed'))
    }
    if (!rec.responseBodyHash) continue
    const ct = (rec.responseHeaders?.['content-type'] ?? '').split(';')[0]?.trim() ?? ''
    const ext = EXT_BY_TYPE[ct] ?? extFromUrl(rec.url)
    const from = join(dir, 'blobs', rec.responseBodyHash)
    const to = join(dir, 'assets', `${rec.responseBodyHash}${ext}`)
    if (existsSync(from) && !existsSync(to)) { copyFileSync(from, to); assetCount++ }
  }

  // C-4 — closed world. Referenced by a tree or a stylesheet and still not here.
  const refs = new Set<string>()
  for (const snap of snapshots) for (const r of snap.refs) refs.add(r)
  const unresolved = [...refs]
    .filter((r) => !fetched.has(r))
    .sort()
    .map((url) => ({ url, reason: failure.get(url) ?? 'never fetched' }))

  const byHost = new Map<string, number>()
  for (const { url } of unresolved) {
    const host = hostOf(url)
    byHost.set(host, (byHost.get(host) ?? 0) + 1)
  }
  const unresolvedByHost = [...byHost.entries()]
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count)

  // timeline: the journal is the timeline; publish it under its spec name
  const journal = join(dir, 'journal.jsonl')
  if (existsSync(journal)) copyFileSync(journal, join(dir, 'timeline.jsonl'))

  const errors = existsSync(join(dir, 'errors.json'))
    ? (JSON.parse(readFileSync(join(dir, 'errors.json'), 'utf8')) as unknown[]).length
    : 0

  const report: CloseReport = {
    schema: CLOSURE_SCHEMA,
    sessionId,
    snapshots: snapshots.length,
    requests: network.length,
    assets: assetCount,
    styles: styleCount,
    trees: countFiles(join(dir, 'trees')),
    resolved,
    unresolved,
    unresolvedByHost,
    errors,
    status: meta.status,
  }
  writeFileSync(join(dir, 'closure.json'), JSON.stringify(report, null, 2))
  meta.stats.snapshots = snapshots.length
  meta.stats.requests = network.length
  writeMeta(meta)
  return report
}

function countFiles(dir: string): number {
  return existsSync(dir) ? readdirSync(dir).length : 0
}

function readJsonDir<T>(dir: string): T[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T)
}

/**
 * Artifacts carry a schema version, and the reader is **strict**: a report written
 * by a different build is not translated, it is refused.
 *
 * No compatibility shims during V1 (repo law). A translator would have to grow a
 * branch for every shape the artifact has ever had, and each branch is a silent
 * guess about data nobody can check any more. Refusing is honest and actionable:
 * the panel says the session was closed by an older build, and offers to delete it.
 *
 * Missing property = fail, never skip-if-absent.
 */
export function readClosure(raw: unknown): CloseReport | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.schema !== CLOSURE_SCHEMA) return null

  const numbers = ['snapshots', 'requests', 'assets', 'styles', 'trees', 'resolved', 'errors'] as const
  for (const key of numbers) if (typeof r[key] !== 'number') return null
  if (typeof r.sessionId !== 'string' || typeof r.status !== 'string') return null
  if (!Array.isArray(r.unresolved) || !Array.isArray(r.unresolvedByHost)) return null
  if (r.unresolved.some((u) => typeof (u as any)?.url !== 'string')) return null

  return raw as CloseReport
}

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return '(unparsable)' }
}

function extFromUrl(url: string): string {
  try {
    const e = extname(new URL(url).pathname)
    return /^\.[a-z0-9]{1,6}$/i.test(e) ? e : ''
  } catch { return '' }
}
