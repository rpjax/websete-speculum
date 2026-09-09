export interface Stats { snapshots: number; requests: number; bytes: number; atoms: number; errors: number }
export interface SessionMeta {
  id: string; name: string; status: string; origins: string[]
  openedAt: string; closedAt?: string; stats: Stats
}
export interface TapeEntry { seq: number; at: string; kind: string; text: string; tone: string }
export interface CloseReport {
  sessionId: string; snapshots: number; requests: number; assets: number; styles: number
  trees: number; resolved: number
  unresolved: { url: string; reason: string }[]
  unresolvedByHost: { host: string; count: number }[]
  errors: number; status: string
}
export interface SnapshotRecord {
  id: string; trigger: string; at: string; url: string; title: string
  viewport: { width: number; height: number; dpr: number }
  tree: string; styles: string[]; refs: string[]; unsettled?: boolean
}
export interface RunManifest {
  runId: string; sessionId: string; emitter: string; createdAt: string
  diskBytes?: number
  primaryHost: string; entry: string; files: number; bytes: number
  missing: string[]; rewrites: { file: string; count: number }[]; warnings: string[]
}
export type PreviewMode = 'off' | 'fixtures' | 'proxy'
export interface PreviewTapeEntry {
  seq: number; at: string; kind: string; method: string; url: string; status?: number; note?: string
}
export interface PreviewSummary {
  runId: string; sessionId: string; url: string; port: number
  mode: PreviewMode; proxyBase: string | null; tape: PreviewTapeEntry[]
}
export interface ParityGap { layer: string; summary: string; url?: string; note?: string }
export interface ParityOracleO4 {
  pass: boolean; missing: number; missingAsset: number; blocked: number
  fixture: number; ignored?: number; gaps: ParityGap[]
}
export interface ParityOracleO4b {
  pass: boolean
  graphqlMissing: { pq?: string; operationName?: string; note?: string }[]
}
export interface ParityOracleO1 {
  pass: boolean; skipped?: boolean; reason?: string
  differPct?: number; diffPixels?: number; totalPixels?: number
  maxRegion?: { w: number; h: number }
}
export interface ParityReport {
  schema: number; sessionId: string; runId: string; at: string
  entrySnapId: string; viewport: { width: number; height: number; dpr: number }
  pass: boolean; ignored?: number
  oracles: { O4: ParityOracleO4; O4b: ParityOracleO4b; O1: ParityOracleO1 }
  gaps: ParityGap[]
}
export interface SessionDetail {
  meta: SessionMeta; snapshots: SnapshotRecord[]; closure: CloseReport | null
  errors: unknown[]; dir: string; runs: (RunManifest & { diskBytes: number })[]
  disk: { bytes: number; files: number }
}
export interface Incompatible { id: string; reason: string }
export interface PanelState {
  recording: boolean; session: SessionMeta | null; inflight: number
  browserAlive: boolean; stall: string | null
  tape: TapeEntry[]; lastReport: CloseReport | null; sessions: SessionMeta[]
  incompatible: Incompatible[]
  previews: PreviewSummary[]
}

function errorText(body: any, status: number): string {
  if (typeof body?.error === 'string' && typeof body?.message === 'string') return `${body.error}: ${body.message}`
  if (typeof body?.error === 'string') return body.error
  if (typeof body?.message === 'string') return body.message
  return `request failed (${status})`
}

/** A POST with no payload must not announce a JSON body (S-11). */
async function post<T>(url: string, payload?: unknown): Promise<T> {
  const init: RequestInit = payload === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
  const res = await fetch(url, init)
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(errorText(body, res.status))
  return body as T
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(errorText(body, res.status))
  return body as T
}

export const api = {
  state: () => get<PanelState>('/api/state'),
  home: () => get<{ root: string; platform: string }>('/api/home'),
  start: (body: { name: string; url?: string; settleMs?: number }) =>
    post<{ session: SessionMeta }>('/api/record/start', body),
  mark: () => post<{ snapshot: SnapshotRecord | null }>('/api/record/mark'),
  close: () => post<{ report: CloseReport }>('/api/record/close'),
  session: (id: string) => get<SessionDetail>(`/api/session/${id}`),
  generate: (sessionId: string, emitter: 'flat' | 'rehost') =>
    post<{ manifest: RunManifest }>('/api/generate', {
      sessionId,
      profile: { emitter, apiBase: null, hosts: {}, defaultDisposition: 'stub' },
    }),
  previewStart: (sessionId: string, runId: string, mode: PreviewMode, proxyBase?: string | null) =>
    post<{ preview: { runId: string; url: string; port: number; mode: PreviewMode } }>(
      '/api/preview/start', { sessionId, runId, mode, proxyBase },
    ),
  previewMode: (runId: string, mode: PreviewMode, proxyBase?: string | null) =>
    post<{ ok: true }>('/api/preview/mode', { runId, mode, proxyBase }),
  previewStop: (runId: string) => post<{ ok: true }>('/api/preview/stop', { runId }),
  parityRun: (sessionId: string, runId: string) =>
    post<{ ok: true; report: ParityReport }>('/api/parity/run', { sessionId, runId }),
  parityReport: (sessionId: string, runId: string) =>
    get<{ ok: true; report: ParityReport }>(
      `/api/parity/report?sessionId=${encodeURIComponent(sessionId)}&runId=${encodeURIComponent(runId)}`,
    ),
  parityAssetUrl: (sessionId: string, runId: string, file: string) =>
    `/api/parity/asset?sessionId=${encodeURIComponent(sessionId)}&runId=${encodeURIComponent(runId)}&file=${encodeURIComponent(file)}`,
  parityReferenceUrl: (sessionId: string, snapId: string) =>
    `/api/parity/reference?sessionId=${encodeURIComponent(sessionId)}&snapId=${encodeURIComponent(snapId)}`,
  reveal: (path: string) => post<{ ok: true }>('/api/reveal', { path }),
  sizes: () => get<Record<string, number>>('/api/sizes'),
  rename: (id: string, name: string) => post<{ ok: true }>('/api/session/rename', { id, name }),
  remove: (ids: string[]) =>
    post<{ deleted: string[]; refused: { id: string; reason: string }[] }>('/api/session/delete', { ids }),
  removeRun: (sessionId: string, runId: string) =>
    post<{ ok: true }>('/api/run/delete', { sessionId, runId }),
}

export function connect(
  onMessage: (msg: any) => void,
  onConnection: (online: boolean) => void,
): () => void {
  let socket: WebSocket | null = null
  let dead = false
  const open = () => {
    if (dead) return
    socket = new WebSocket(`ws://${location.host}/ws`)
    socket.onopen = () => onConnection(true)
    socket.onmessage = (e) => onMessage(JSON.parse(e.data))
    socket.onclose = () => {
      if (dead) return
      onConnection(false)
      setTimeout(open, 1000)
    }
    socket.onerror = () => { try { socket?.close() } catch { /* already gone */ } }
  }
  open()
  return () => { dead = true; socket?.close() }
}

/** Local conveniences only — never state anything depends on. */
export const remembered = {
  read<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`imago:${key}`)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch { return fallback }
  },
  write(key: string, value: unknown): void {
    try { localStorage.setItem(`imago:${key}`, JSON.stringify(value)) } catch { /* private mode */ }
  },
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
