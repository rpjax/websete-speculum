import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { sessionDir } from '../core/store.js'
import type { SnapshotRecord } from '../core/types.js'

export function readSnapshots(sessionId: string): SnapshotRecord[] {
  const dir = join(sessionDir(sessionId), 'snapshots')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as SnapshotRecord)
    .sort((a, b) => a.at.localeCompare(b.at))
}

/** Same entry rule as rehost generate (emit.md / rehost.ts). */
export function entrySnapshot(snapshots: SnapshotRecord[]): SnapshotRecord | null {
  if (snapshots.length === 0) return null
  return snapshots.find((s) => s.trigger === 'mark') ?? snapshots[0]!
}

/** Entry + every mark snapshot — oracle reference targets (D-034). */
export function oracleSnapshotTargets(snapshots: SnapshotRecord[]): SnapshotRecord[] {
  const entry = entrySnapshot(snapshots)
  const out: SnapshotRecord[] = []
  const seen = new Set<string>()
  for (const s of [...(entry ? [entry] : []), ...snapshots.filter((x) => x.trigger === 'mark')]) {
    if (!seen.has(s.id)) { seen.add(s.id); out.push(s) }
  }
  return out
}
