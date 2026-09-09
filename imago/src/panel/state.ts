import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  deleteRun, deleteSession, dirSize, listIncompatible, listRuns, listSessions, readMeta,
  readOverlay, runDir, sessionDir, writeMeta, writeOverlay,
} from '../core/store.js'
import { generateFlat } from '../generate/flat.js'
import { generateRehost } from '../generate/rehost.js'
import { DEFAULT_PROFILE, type GenerationProfile, type RunManifest } from '../generate/types.js'
import { startPreview, type PreviewHandle, type PreviewMode } from '../preview/server.js'
import { finalize, readClosure, type CloseReport } from '../ir/close.js'
import { Recorder } from '../recorder/recorder.js'
import { runParity, readParityReport, parityDir } from '../parity/run.js'
import type { ParityReport } from '../parity/types.js'
import type { SessionConfig, SessionMeta, SnapshotRecord, TimelineEvent } from '../core/types.js'

export interface TapeEntry {
  seq: number
  at: string
  kind: string
  text: string
  tone: 'plain' | 'good' | 'warn' | 'bad'
}

/**
 * Holds the one recording a panel can have open at a time, and the tape the UI
 * renders. The recorder itself never depends on this — a dead panel must never
 * break a recording (C-0 in spirit: the human owns the browser).
 */
class PanelState {
  private recorder: Recorder | null = null
  private tape: TapeEntry[] = []
  private seq = 0
  private listeners = new Set<(msg: unknown) => void>()
  private readonly previews = new Map<string, PreviewHandle>()
  lastReport: CloseReport | null = null

  subscribe(fn: (msg: unknown) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private push(msg: unknown): void {
    for (const fn of this.listeners) { try { fn(msg) } catch { /* ignore */ } }
  }

  get recording(): boolean { return this.recorder !== null }

  snapshotOfState() {
    return {
      recording: this.recording,
      session: this.recorder ? this.recorder.metadata : null,
      /** S-8 — the browser can die while the session stays open and closable. */
      browserAlive: this.recorder ? this.recorder.alive : false,
      stall: this.recorder ? this.recorder.stall : null,
      inflight: this.recorder ? this.recorder.inflightCount : 0,
      tape: this.tape.slice(-200),
      lastReport: this.lastReport,
      sessions: listSessions(),
      /** written by another build — the operator deletes them, nothing else does */
      incompatible: listIncompatible(),
      previews: this.previewSummaries(),
    }
  }

  previewSummaries() {
    return [...this.previews.values()].map((p) => ({
      runId: p.runId, sessionId: p.sessionId, url: p.url, port: p.port,
      mode: p.mode, proxyBase: p.proxyBase, tape: p.tape.slice(-300),
    }))
  }

  // ── generate (D-005 / IR-6) ──────────────────────────────────────────────────
  generate(sessionId: string, profile: GenerationProfile = DEFAULT_PROFILE): RunManifest {
    const meta = readMeta(sessionId)
    if (!meta) throw new Error(`unknown session ${sessionId}`)
    if (meta.status === 'recording' || meta.status === 'closing') {
      throw new Error('close the sandbox first — generation reads a closed session')
    }
    // The profile names the emitter; there is no implicit choice (E-6's principle).
    const manifest = profile.emitter === 'rehost'
      ? generateRehost(sessionId, profile)
      : generateFlat(sessionId, profile)
    this.push({ type: 'runs', sessionId })
    return manifest
  }

  // ── preview (D-016…D-020) ────────────────────────────────────────────────────
  async openPreview(sessionId: string, runId: string, mode: PreviewMode, proxyBase?: string | null) {
    const existing = this.previews.get(runId)
    if (existing) {
      existing.setMode(mode, proxyBase ?? null)
      this.push({ type: 'previews', previews: this.previewSummaries() })
      return existing
    }
    const dir = runDir(sessionId, runId)
    const run = listRuns(sessionId).find((r) => r.runId === runId)
    if (!run) throw new Error(`unknown run ${runId}`)
    const handle = await startPreview({
      runDir: dir,
      manifest: run.manifest as RunManifest,
      mode,
      proxyBase: proxyBase ?? null,
      onTape: (entry) => this.push({ type: 'preview-tape', runId, entry }),
    })
    this.previews.set(runId, handle)
    this.push({ type: 'previews', previews: this.previewSummaries() })
    return handle
  }

  setPreviewMode(runId: string, mode: PreviewMode, proxyBase?: string | null): void {
    const handle = this.previews.get(runId)
    if (!handle) throw new Error('this preview is not running')
    handle.setMode(mode, proxyBase ?? null)
    this.push({ type: 'previews', previews: this.previewSummaries() })
  }

  async closePreview(runId: string): Promise<void> {
    const handle = this.previews.get(runId)
    if (!handle) return
    this.previews.delete(runId)
    await handle.stop().catch(() => undefined)
    this.push({ type: 'previews', previews: this.previewSummaries() })
  }

  async stopAllPreviews(): Promise<void> {
    await Promise.all([...this.previews.keys()].map((id) => this.closePreview(id)))
  }

  async runParityCheck(sessionId: string, runId: string): Promise<ParityReport> {
    const run = listRuns(sessionId).find((r) => r.runId === runId)
    if (!run) throw new Error(`unknown run ${runId}`)
    const report = await runParity({
      sessionId,
      runId,
      manifest: run.manifest as RunManifest,
    })
    this.push({ type: 'parity', sessionId, runId, report })
    return report
  }

  getParityReport(sessionId: string, runId: string): ParityReport | null {
    return readParityReport(sessionId, runId)
  }

  parityAssetPath(sessionId: string, runId: string, rel: string): string | null {
    const base = parityDir(sessionId, runId)
    const target = join(base, rel)
    if (!target.startsWith(base)) return null
    if (!existsSync(target)) return null
    return target
  }

  async start(config: SessionConfig, name: string, url?: string): Promise<SessionMeta> {
    if (this.recorder) throw new Error('a recording is already open — close the sandbox first')
    this.tape = []
    this.seq = 0
    this.lastReport = null
    const recorder = new Recorder(config, name)
    recorder.onEvent = (event, stats) => {
      const entry = toTape(event, ++this.seq)
      if (entry) {
        this.tape.push(entry)
        if (this.tape.length > 2000) this.tape.splice(0, this.tape.length - 2000)
        this.push({ type: 'tape', entry })
      }
      this.push({
        type: 'stats', stats, inflight: recorder.inflightCount,
        browserAlive: recorder.alive, stall: recorder.stall,
      })
      if (!recorder.alive) this.push({ type: 'status', recording: true, session: recorder.metadata })
    }
    await recorder.start(url)
    this.recorder = recorder
    this.push({ type: 'status', recording: true, session: recorder.metadata })
    return recorder.metadata
  }

  async mark(): Promise<SnapshotRecord | null> {
    if (!this.recorder) throw new Error('not recording')
    return this.recorder.markActive()
  }

  async close(): Promise<CloseReport> {
    if (!this.recorder) throw new Error('not recording')
    const { meta } = await this.recorder.close()
    this.recorder = null
    const report = finalize(meta.id)
    this.lastReport = report
    this.push({ type: 'status', recording: false, session: null, report })
    return report
  }

  // ── management ───────────────────────────────────────────────────────────────

  /** Renaming writes to the overlay; the session stays immutable (S-1). */
  rename(id: string, name: string): void {
    if (!readMeta(id)) throw new Error(`unknown session ${id}`)
    writeOverlay(id, { name: name.trim() || undefined })
    this.push({ type: 'status', recording: this.recording, session: this.recorder?.metadata ?? null })
  }

  /** Irreversible, so it refuses whatever it cannot safely remove. */
  async remove(ids: string[]): Promise<{ deleted: string[]; refused: { id: string; reason: string }[] }> {
    const deleted: string[] = []
    const refused: { id: string; reason: string }[] = []
    for (const id of ids) {
      if (this.recorder && this.recorder.metadata.id === id) {
        refused.push({ id, reason: 'this session is recording — close the sandbox first' })
        continue
      }
      // A preview holds a run of this session open; stop it rather than deleting under it.
      for (const p of [...this.previews.values()]) {
        if (p.sessionId === id) await this.closePreview(p.runId)
      }
      try { deleteSession(id); deleted.push(id) }
      catch (e) { refused.push({ id, reason: e instanceof Error ? e.message : String(e) }) }
    }
    this.push({ type: 'status', recording: this.recording, session: this.recorder?.metadata ?? null })
    return { deleted, refused }
  }

  /** A run is regenerable; deleting one is cheap and never touches the session. */
  async removeRun(sessionId: string, runId: string): Promise<void> {
    await this.closePreview(runId)
    deleteRun(sessionId, runId)
    this.push({ type: 'runs', sessionId })
  }

  sizes(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const meta of listSessions()) out[meta.id] = dirSize(sessionDir(meta.id)).bytes
    return out
  }

  detail(id: string) {
    const meta = readMeta(id)
    if (!meta) return null
    const dir = sessionDir(id)
    const snapDir = join(dir, 'snapshots')
    const snapshots: SnapshotRecord[] = existsSync(snapDir)
      ? readdirSync(snapDir).filter((f) => f.endsWith('.json'))
          .map((f) => JSON.parse(readFileSync(join(snapDir, f), 'utf8')) as SnapshotRecord)
      : []
    const closureFile = join(dir, 'closure.json')
    const closure = existsSync(closureFile)
      ? readClosure(JSON.parse(readFileSync(closureFile, 'utf8')))
      : null
    const errors = existsSync(join(dir, 'errors.json'))
      ? (JSON.parse(readFileSync(join(dir, 'errors.json'), 'utf8')) as unknown[])
      : []
    const runs = listRuns(id).map((r) => ({ ...(r.manifest as object), diskBytes: dirSize(r.path).bytes }))
    return {
      meta: { ...meta, name: readOverlay(id).name ?? meta.name },
      snapshots, closure, errors, dir, runs,
      disk: dirSize(dir),
    }
  }
}

function appendError(id: string, code: string, detail: string): void {
  const path = join(sessionDir(id), 'errors.json')
  let errors: unknown[] = []
  try { if (existsSync(path)) errors = JSON.parse(readFileSync(path, 'utf8')) as unknown[] } catch { errors = [] }
  errors.push({ code, detail, at: new Date().toISOString() })
  try { writeFileSync(path, JSON.stringify(errors, null, 2)) } catch { /* disk gone; nothing left to do */ }
}

function toTape(e: TimelineEvent, seq: number): TapeEntry | null {
  switch (e.t) {
    case 'navigation': return { seq, at: e.at, kind: 'nav', text: e.url, tone: 'plain' }
    case 'snapshot': return { seq, at: e.at, kind: `snapshot:${e.trigger}`, text: e.snapId, tone: e.trigger === 'mark' ? 'good' : 'plain' }
    case 'mark': return { seq, at: e.at, kind: 'mark', text: e.name, tone: 'good' }
    case 'stall': return { seq, at: e.at, kind: `waiting:${e.reason}`, text: e.detail, tone: 'warn' }
    case 'resolve': return {
      seq, at: e.at, kind: `downloading assets`,
      text: `${e.label ?? 'refs'}: ${e.done}/${e.total}${e.failed ? ` · ${e.failed} failed` : ''}`,
      tone: 'plain',
    }
    case 'error': return { seq, at: e.at, kind: e.code, text: e.detail, tone: 'bad' }
    case 'session.open': return { seq, at: e.at, kind: 'session', text: `opened ${e.session}`, tone: 'plain' }
    case 'session.close': return { seq, at: e.at, kind: 'session', text: 'closing sandbox', tone: 'warn' }
    default: return null // request events are counted, not tailed — the tape stays readable
  }
}

/**
 * S-9 — orphan recovery. A session left in `recording` belongs to a process that
 * is gone: the app was killed, or it died with the browser. What was journalled is
 * still on disk, so finalize it and mark it failed. A session is never left
 * claiming to be live by a process that no longer exists.
 */
export function recoverOrphans(): string[] {
  const recovered: string[] = []
  for (const meta of listSessions()) {
    if (meta.status !== 'recording' && meta.status !== 'closing') continue
    meta.status = 'failed'
    meta.closedAt = new Date().toISOString()
    writeMeta(meta)
    try {
      finalize(meta.id)
    } catch (e) {
      // Never swallow: a session too damaged to finalize says so on disk.
      appendError(meta.id, 'recovery_failed', String(e).slice(0, 300))
    }
    recovered.push(meta.id)
  }
  return recovered
}

export const panel = new PanelState()
