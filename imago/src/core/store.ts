import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { SessionMeta } from './types.js'

export const SESSION_SCHEMA = 1

/** Human curation, kept out of the immutable session (S-1 / IR-7). */
export interface Overlay {
  name?: string
  atoms?: Record<string, string>
  volatile?: string[]
}

/** Where Imago keeps its own state. Never inside the observed project (I7). */
export function imagoRoot(): string {
  return process.env.IMAGO_HOME ?? join(process.cwd(), '.imago')
}

export function sessionsDir(): string {
  return join(imagoRoot(), 'sessions')
}

export function sessionDir(id: string): string {
  return join(sessionsDir(), id)
}

export function profileDir(): string {
  return join(imagoRoot(), 'chrome-profile')
}

export function newSessionId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `sess-${stamp}`
}

/** Generation runs live beside the session but never inside it (S-1/S-2). */
export function runsDir(sessionId: string): string {
  return join(sessionDir(sessionId), 'runs')
}

export function runDir(sessionId: string, runId: string): string {
  return join(runsDir(sessionId), runId)
}

export function listRuns(sessionId: string): { runId: string; path: string; manifest: unknown }[] {
  const dir = runsDir(sessionId)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((runId) => {
      const path = join(dir, runId)
      const file = join(path, 'imago-run.json')
      if (!existsSync(file)) return null
      return { runId, path, manifest: JSON.parse(readFileSync(file, 'utf8')) as unknown }
    })
    .filter((r): r is { runId: string; path: string; manifest: unknown } => r !== null)
    .sort((a, b) => b.runId.localeCompare(a.runId))
}

export function ensureDirs(id: string): string {
  const dir = sessionDir(id)
  for (const sub of ['', 'blobs', 'snapshots', 'network', 'trees', 'styles', 'assets', 'oracles']) {
    mkdirSync(join(dir, sub), { recursive: true })
  }
  return dir
}

export function readMeta(id: string): SessionMeta | null {
  const path = join(sessionDir(id), 'session.json')
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as SessionMeta
}

export function writeMeta(meta: SessionMeta): void {
  writeFileSync(join(sessionDir(meta.id), 'session.json'), JSON.stringify(meta, null, 2))
}

/** Sessions this build can read. A malformed one never reaches the panel's table. */
export function listSessions(): SessionMeta[] {
  const dir = sessionsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((id) => {
      const meta = readMeta(id)
      if (!meta || meta.schema !== SESSION_SCHEMA || !meta.stats || !meta.openedAt) return null
      const overlay = readOverlay(id)
      // The overlay renames; the session itself is never rewritten (S-1).
      return overlay.name ? { ...meta, name: overlay.name } : meta
    })
    .filter((m): m is SessionMeta => m !== null)
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
}

/**
 * S-12 — a session this build cannot read is **listed apart, never adapted and
 * never auto-removed**.
 *
 * There is no compatibility layer and there will not be one (the program is not
 * released): a translator grows a branch per historical shape, and each branch is a
 * silent guess about data nobody can verify. The answer is to wipe the data — but
 * **deletion is the operator's, always.** Nothing here removes a byte on its own.
 */
export function listIncompatible(): { id: string; reason: string }[] {
  const dir = sessionsDir()
  if (!existsSync(dir)) return []
  const out: { id: string; reason: string }[] = []
  for (const id of readdirSync(dir)) {
    const file = join(sessionDir(id), 'session.json')
    if (!existsSync(file)) { out.push({ id, reason: 'no session.json' }); continue }
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      if (raw.schema !== SESSION_SCHEMA) {
        out.push({ id, reason: `session schema ${raw.schema ?? 'missing'} — this build reads ${SESSION_SCHEMA}` })
      }
    } catch (e) {
      out.push({ id, reason: `unreadable session.json: ${String(e).slice(0, 80)}` })
    }
  }
  return out
}

export function readOverlay(id: string): Overlay {
  const path = join(sessionDir(id), 'overlay.json')
  if (!existsSync(path)) return {}
  try { return JSON.parse(readFileSync(path, 'utf8')) as Overlay } catch { return {} }
}

export function writeOverlay(id: string, patch: Overlay): Overlay {
  const merged = { ...readOverlay(id), ...patch }
  writeFileSync(join(sessionDir(id), 'overlay.json'), JSON.stringify(merged, null, 2))
  return merged
}

/** Bytes on disk, walked. Used for management, computed on demand. */
export function dirSize(path: string): { bytes: number; files: number } {
  let bytes = 0
  let files = 0
  const walk = (p: string) => {
    let entries: string[]
    try { entries = readdirSync(p) } catch { return }
    for (const e of entries) {
      const child = join(p, e)
      let st
      try { st = statSync(child) } catch { continue }
      if (st.isDirectory()) walk(child)
      else { bytes += st.size; files++ }
    }
  }
  walk(path)
  return { bytes, files }
}

/**
 * Deletion is irreversible, so it is fenced: only inside IMAGO_HOME, and only a
 * path that actually looks like one of ours. A management action that can reach
 * outside its own store is not a management action.
 */
function assertInsideHome(target: string): void {
  const root = resolve(imagoRoot())
  const path = resolve(target)
  if (!path.startsWith(root + '/') && !path.startsWith(root + '\\')) {
    throw new Error('refusing to delete outside the imago home')
  }
}

export function deleteSession(id: string): void {
  const dir = sessionDir(id)
  assertInsideHome(dir)
  if (!existsSync(dir)) return
  rmSync(dir, { recursive: true, force: true })
}

export function deleteRun(sessionId: string, runId: string): void {
  const dir = runDir(sessionId, runId)
  assertInsideHome(dir)
  if (!existsSync(dir)) return
  rmSync(dir, { recursive: true, force: true })
}
