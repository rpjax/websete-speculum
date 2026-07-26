import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSessionClient } from '@/lib/speculum'
import type { LiveSession, SessionClient } from '@/lib/speculum'
import type { SessionFrame, SessionInput, SessionStatus } from '@/lib/speculum'
import {
  clearProfileId,
  loadOrigins,
  loadProfileId,
  saveOrigins,
  saveProfileId,
  type SmokeOrigins,
} from './smokeConfig'
import { describe, SMOKE_LOG_LIMIT, type SmokeLogEntry, type SmokeLogLevel } from './smokeLog'
import { useJournalFeed } from './useJournalFeed'

export type SmokePhase = 'idle' | 'connecting' | 'connected' | 'starting' | 'live' | 'stopping'

export interface SmokeStats {
  frames: number
  fps: number
  lastFrameBytes: number
  throughputKbps: number
  lastSequence: number
  staleFrames: number
  relayLagMs: number | null
  inputToFrameMs: number | null
  inputsSent: number
  lastInputType: string | null
  notifications: number
  consoleMessages: number
}

export interface SmokeViewport {
  width: number
  height: number
}

const EMPTY_STATS: SmokeStats = {
  frames: 0,
  fps: 0,
  lastFrameBytes: 0,
  throughputKbps: 0,
  lastSequence: -1,
  staleFrames: 0,
  relayLagMs: null,
  inputToFrameMs: null,
  inputsSent: 0,
  lastInputType: null,
  notifications: 0,
  consoleMessages: 0,
}

type FrameSink = (frame: SessionFrame) => void

interface FrameCounters {
  frames: number
  windowFrames: number
  windowBytes: number
  windowStartedAt: number
  lastSequence: number
  staleFrames: number
  relayLagMs: number | null
  lastFrameBytes: number
  inputsSent: number
  lastInputType: string | null
  lastInputAt: number | null
  inputToFrameMs: number | null
  notifications: number
  consoleMessages: number
  dirty: boolean
}

function freshCounters(): FrameCounters {
  return {
    frames: 0,
    windowFrames: 0,
    windowBytes: 0,
    windowStartedAt: performance.now(),
    lastSequence: -1,
    staleFrames: 0,
    relayLagMs: null,
    lastFrameBytes: 0,
    inputsSent: 0,
    lastInputType: null,
    lastInputAt: null,
    inputToFrameMs: null,
    notifications: 0,
    consoleMessages: 0,
    dirty: false,
  }
}

/**
 * Drives one smoke session: hub connect → EnsureProfile → StartSession →
 * WebTransport frames/inputs. Frames bypass React state; the canvas subscribes
 * through {@link attachFrameSink} and stats land on a 500 ms tick.
 */
export function useSmokeSession(viewport: SmokeViewport) {
  const [origins, setOriginsState] = useState<SmokeOrigins>(() => loadOrigins())
  const [phase, setPhase] = useState<SmokePhase>('idle')
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<string | null>(() => loadProfileId())
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [entries, setEntries] = useState<SmokeLogEntry[]>([])
  const [stats, setStats] = useState<SmokeStats>(EMPTY_STATS)
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)

  const clientRef = useRef<SessionClient | null>(null)
  const sessionRef = useRef<LiveSession | null>(null)
  const sinksRef = useRef(new Set<FrameSink>())
  const countersRef = useRef<FrameCounters>(freshCounters())
  const logIdRef = useRef(0)

  const log = useCallback((level: SmokeLogLevel, label: string, detail?: unknown) => {
    const entry: SmokeLogEntry = {
      id: ++logIdRef.current,
      at: Date.now(),
      level,
      label,
      detail: describe(detail),
    }
    setEntries((previous) => [entry, ...previous].slice(0, SMOKE_LOG_LIMIT))
  }, [])

  const client = useMemo(() => {
    const created = createSessionClient({
      baseUrl: origins.hubOrigin,
      transportBaseUrl: origins.transportOrigin,
    })
    clientRef.current = created
    return created
  }, [origins.hubOrigin, origins.transportOrigin])

  const hubConnected = phase !== 'idle' && phase !== 'connecting'
  const journal = useJournalFeed(client, hubConnected)

  useEffect(() => {
    const disposers = [
      client.on('hubClose', (error) => {
        log('warn', 'hub closed', error)
        setPhase('idle')
        setConnectionId(null)
        setSessionId(null)
      }),
      client.on('hubReconnecting', () => log('warn', 'hub reconnecting')),
      client.on('hubReconnected', () => log('info', 'hub reconnected')),
    ]
    return () => {
      for (const dispose of disposers) {
        dispose()
      }
      void client.disconnect()
    }
  }, [client, log])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const counters = countersRef.current
      if (!counters.dirty) {
        return
      }
      const now = performance.now()
      const elapsed = now - counters.windowStartedAt
      const fps = elapsed > 0 ? (counters.windowFrames * 1000) / elapsed : 0
      const throughputKbps = elapsed > 0 ? (counters.windowBytes * 8) / elapsed : 0
      counters.windowFrames = 0
      counters.windowBytes = 0
      counters.windowStartedAt = now
      counters.dirty = false
      setStats({
        frames: counters.frames,
        fps: Math.round(fps * 10) / 10,
        lastFrameBytes: counters.lastFrameBytes,
        throughputKbps: Math.round(throughputKbps),
        lastSequence: counters.lastSequence,
        staleFrames: counters.staleFrames,
        relayLagMs: counters.relayLagMs,
        inputToFrameMs: counters.inputToFrameMs,
        inputsSent: counters.inputsSent,
        lastInputType: counters.lastInputType,
        notifications: counters.notifications,
        consoleMessages: counters.consoleMessages,
      })
    }, 500)
    return () => window.clearInterval(timer)
  }, [])

  const attachFrameSink = useCallback((sink: FrameSink) => {
    sinksRef.current.add(sink)
    return () => {
      sinksRef.current.delete(sink)
    }
  }, [])

  const onFrame = useCallback((frame: SessionFrame) => {
    const counters = countersRef.current
    const sequence = Number(frame.sequence ?? 0)
    counters.dirty = true
    if (sequence <= counters.lastSequence) {
      counters.staleFrames += 1
      return
    }
    counters.lastSequence = sequence
    counters.frames += 1
    counters.windowFrames += 1
    counters.lastFrameBytes = frame.jpeg?.byteLength ?? 0
    counters.windowBytes += counters.lastFrameBytes
    const relayTimestamp = Number(frame.timestamp ?? 0)
    counters.relayLagMs = relayTimestamp > 0 ? Date.now() - relayTimestamp : null
    if (counters.lastInputAt != null) {
      counters.inputToFrameMs = Math.round(performance.now() - counters.lastInputAt)
      counters.lastInputAt = null
    }
    for (const sink of sinksRef.current) {
      sink(frame)
    }
  }, [])

  const bind = useCallback(
    (session: LiveSession) => {
      sessionRef.current = session
      session.on('frame', onFrame)
      session.on('console', (message) => {
        countersRef.current.consoleMessages += 1
        countersRef.current.dirty = true
        log('wire', 'console', message)
      })
      session.on('notification', (notification) => {
        countersRef.current.notifications += 1
        countersRef.current.dirty = true
        log(notification.errorCode ? 'warn' : 'wire', 'notification', notification)
      })
      session.on('syncUrl', (url) => {
        setCurrentUrl(url)
        log('wire', 'syncUrl', { url })
      })
      session.on('redirect', (url) => {
        log('info', 'redirect', { url })
        if (url.startsWith('https:') || url.startsWith('http:')) {
          window.location.href = url
        }
      })
      if (session.lastSyncedUrl) {
        setCurrentUrl(session.lastSyncedUrl)
      }
      if (session.lastRedirectUrl &&
        (session.lastRedirectUrl.startsWith('https:') ||
          session.lastRedirectUrl.startsWith('http:'))) {
        log('info', 'redirect', { url: session.lastRedirectUrl })
        window.location.href = session.lastRedirectUrl
      }
      session.on('error', (error) => log('error', 'data plane error', error))
      session.on('close', () => {
        if (sessionRef.current === session) {
          sessionRef.current = null
          setSessionId(null)
          setPhase(client.isConnected ? 'connected' : 'idle')
        }
        log('info', 'session closed')
      })
    },
    [client, log, onFrame],
  )

  const connect = useCallback(async () => {
    if (client.isConnected) {
      return true
    }
    setPhase('connecting')
    try {
      await client.connect()
      setConnectionId(client.connectionId)
      setPhase('connected')
      log('info', 'hub connected', { connectionId: client.connectionId })
      return true
    } catch (error) {
      setPhase('idle')
      log('error', 'hub connect failed', error)
      return false
    }
  }, [client, log])

  const start = useCallback(
    async (path: string) => {
      if (!(await connect())) {
        return
      }
      setPhase('starting')
      countersRef.current = freshCounters()
      setStats(EMPTY_STATS)
      setStatus(null)
      try {
        const ensured = await client.ensureProfile(loadProfileId())
        saveProfileId(ensured.profileId)
        setProfileId(ensured.profileId)
        log('info', ensured.created ? 'profile created' : 'profile reused', ensured)

        log('info', 'hub start…', {
          profileId: ensured.profileId,
          transportOrigin: origins.transportOrigin || '(same origin)',
        })
        const session = await client.startSession({
          profileId: ensured.profileId,
          path: path.startsWith('/') ? path : `/${path}`,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
        })
        bind(session)
        setSessionId(session.sessionId)
        setPhase('live')
        log('info', 'session live', { sessionId: session.sessionId })
      } catch (error) {
        setPhase(client.isConnected ? 'connected' : 'idle')
        log('error', 'start failed', error)
      }
    },
    [bind, client, connect, log, origins.transportOrigin, viewport.height, viewport.width],
  )

  const stop = useCallback(async () => {
    const session = sessionRef.current
    if (!session) {
      return
    }
    setPhase('stopping')
    try {
      await session.stop()
      log('info', 'session stopped')
    } catch (error) {
      log('error', 'stop failed', error)
    } finally {
      sessionRef.current = null
      setSessionId(null)
      setPhase(client.isConnected ? 'connected' : 'idle')
    }
  }, [client, log])

  const sendInput = useCallback((input: SessionInput) => {
    const session = sessionRef.current
    if (!session) {
      return
    }
    const counters = countersRef.current
    counters.inputsSent += 1
    counters.lastInputType = input.type
    counters.lastInputAt = performance.now()
    counters.dirty = true
    void session.sendInput(input).catch((error: unknown) => {
      log('error', `input ${input.type} failed`, error)
    })
  }, [log])

  const pollStatus = useCallback(async () => {
    const session = sessionRef.current
    if (!session) {
      return
    }
    try {
      const snapshot = await session.getStatus()
      setStatus(snapshot)
      setCurrentUrl(snapshot.url || null)
      log('wire', 'status', snapshot)
    } catch (error) {
      log('error', 'status failed', error)
    }
  }, [log])

  const evaluate = useCallback(
    async (code: string) => {
      const session = sessionRef.current
      if (!session || !code.trim()) {
        return
      }
      log('info', 'evaluate', code)
      try {
        const result = await session.evaluate(code)
        log(result.ok ? 'wire' : 'warn', 'eval result', result)
      } catch (error) {
        log('error', 'evaluate failed', error)
      }
    },
    [log],
  )

  const applyOrigins = useCallback(
    (next: SmokeOrigins) => {
      saveOrigins(next)
      setOriginsState({
        hubOrigin: next.hubOrigin.trim().replace(/\/$/, ''),
        transportOrigin: next.transportOrigin.trim().replace(/\/$/, ''),
      })
      setPhase('idle')
      setConnectionId(null)
      setSessionId(null)
      log('info', 'origins updated', next)
    },
    [log],
  )

  const forgetProfile = useCallback(() => {
    clearProfileId()
    setProfileId(null)
    log('info', 'profile forgotten — next start creates a new one')
  }, [log])

  return {
    phase,
    origins,
    connectionId,
    profileId,
    sessionId,
    currentUrl,
    entries,
    journal,
    stats,
    status,
    isLive: phase === 'live',
    attachFrameSink,
    connect,
    start,
    stop,
    sendInput,
    pollStatus,
    evaluate,
    applyOrigins,
    forgetProfile,
  }
}
