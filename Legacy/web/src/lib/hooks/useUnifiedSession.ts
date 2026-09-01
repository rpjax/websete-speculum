import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type SessionDetail } from '@/lib/api'
import {
  diagnosticsApi,
  type MotorSessionDiagnosticsSnapshot,
  type DiagnosticsEventRecord,
} from '@/lib/diagnosticsApi'
import { usePolling } from './usePolling'

export interface UnifiedSessionData {
  snapshot: MotorSessionDiagnosticsSnapshot | null
  events: DiagnosticsEventRecord[]
  persisted: SessionDetail | null
  isLive: boolean
  hasPersistence: boolean
  loading: boolean
  eventsLoading: boolean
  persistedLoading: boolean
  error: string | null
  resolvedConnectionId: string | null
  resolvedSessionId: string | null
  fpsHistory: number[]
}

/**
 * Loads session data from both diagnostics (live telemetry) and CRUD (persisted state) APIs.
 * Accepts either a connectionId or a persistedSessionId as the `id` param and resolves both sides.
 */
export function useUnifiedSession(id: string | undefined) {
  const [snapshot, setSnapshot] = useState<MotorSessionDiagnosticsSnapshot | null>(null)
  const [events, setEvents] = useState<DiagnosticsEventRecord[]>([])
  const [persisted, setPersisted] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [eventsLoading, setEventsLoading] = useState(true)
  const [persistedLoading, setPersistedLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const fpsHistory = useRef<number[]>([])

  const resolvedConnectionId = useRef<string | null>(null)
  const resolvedSessionId = useRef<string | null>(null)

  const loadAll = useCallback(async () => {
    if (!id) return

    let connId: string | null = null
    let sessId: string | null = null

    // Try loading as a connectionId (diagnostics live session)
    try {
      const data = await diagnosticsApi.getSession(id)
      setSnapshot(data)
      setError(null)
      fpsHistory.current = [...fpsHistory.current.slice(-29), data.fps]
      connId = data.connectionId
      sessId = data.persistedSessionId ?? null
    } catch {
      // Not a live session — try resolving as a persistedSessionId
      try {
        const resolved = await diagnosticsApi.resolve({ persistedSessionId: id })
        setSnapshot(resolved.snapshot)
        setError(null)
        fpsHistory.current = [...fpsHistory.current.slice(-29), resolved.snapshot.fps]
        connId = resolved.connectionId
        sessId = resolved.snapshot.persistedSessionId ?? null
      } catch {
        // No live session found — the ID might be a persisted-only session
        sessId = id
      }
    }
    setLoading(false)

    resolvedConnectionId.current = connId
    resolvedSessionId.current = sessId

    // Load events if we have a connectionId
    if (connId) {
      try {
        const evts = await diagnosticsApi.getSessionEvents(connId)
        setEvents(evts)
      } catch { /* events optional */ }
    }
    setEventsLoading(false)

    // Load persisted data if we have a sessionId
    if (sessId) {
      try {
        const detail = await api.getSession(sessId)
        setPersisted(detail)
      } catch { /* persisted data optional */ }
    }
    setPersistedLoading(false)
  }, [id])

  useEffect(() => { void loadAll() }, [loadAll])

  const isLive = snapshot != null && snapshot.sidecarConnected
  usePolling(loadAll, 5_000, autoRefresh && isLive)

  return {
    snapshot,
    events,
    persisted,
    isLive,
    hasPersistence: persisted != null,
    loading,
    eventsLoading,
    persistedLoading,
    error,
    resolvedConnectionId: resolvedConnectionId.current,
    resolvedSessionId: resolvedSessionId.current,
    fpsHistory: fpsHistory.current,
    autoRefresh,
    setAutoRefresh,
    refresh: loadAll,
  }
}
