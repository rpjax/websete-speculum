import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSessionClient } from '@/lib/speculum'
import type { LiveSession, SessionClient } from '@/lib/speculum'
import type {
  EvalResult,
  SessionFrame,
  SessionInput,
  SessionStatus,
} from '@/lib/speculum'
import {
  clearProfileId,
  loadEnvOrigins,
  loadLabOrigins,
  loadProfileId,
  saveLabOrigins,
  saveProfileId,
  type SessionOrigins,
} from './sessionConfig'
import { applySyncedBrowserUrl } from './sessionUrlSync'
import {
  inputConsoleLine,
  lineFromConsoleOutput,
  type SmokeConsoleLine,
} from '@/features/sessions/smoke/smokeConsole'
import {
  describe,
  SMOKE_LOG_LIMIT,
  type SmokeLogEntry,
  type SmokeLogLevel,
} from '@/features/sessions/smoke/smokeLog'
import { useJournalFeed, type JournalFeed } from '@/features/sessions/smoke/useJournalFeed'

export type LiveSessionPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'starting'
  | 'live'
  | 'stopping'

export interface LiveSessionStats {
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

export interface LiveSessionViewport {
  width: number
  height: number
}

export interface UseLiveSessionOptions {
  viewport: LiveSessionViewport
  /**
   * Lab-only observation: Activity log, console feed, stats tick, Journal stream.
   * Does not change start/navigate/input/evaluate — same hub + LiveSession client.
   */
  debug?: boolean
  /**
   * Lab-only Wire overrides (localStorage). Production live uses env origins only.
   */
  labOrigins?: boolean
}

const EMPTY_STATS: LiveSessionStats = {
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

const EMPTY_JOURNAL: JournalFeed = {
  facts: [],
  error: null,
  streaming: false,
  clear: () => {},
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
 * Shared session controller for lab and immersive live.
 * One path: createSessionClient → EnsureProfile → StartSession → WebTransport
 * → NavigateAsync(path/query) → hub → ILiveSession → IUrlResolver.
 */
export function useLiveSession({
  viewport,
  debug = false,
  labOrigins = false,
}: UseLiveSessionOptions) {
  const [origins, setOriginsState] = useState<SessionOrigins>(() =>
    labOrigins ? loadLabOrigins() : loadEnvOrigins(),
  )
  const [phase, setPhase] = useState<LiveSessionPhase>('idle')
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<string | null>(() => loadProfileId())
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [entries, setEntries] = useState<SmokeLogEntry[]>([])
  const [consoleLines, setConsoleLines] = useState<SmokeConsoleLine[]>([])
  const [stats, setStats] = useState<LiveSessionStats>(EMPTY_STATS)
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)

  const clientRef = useRef<SessionClient | null>(null)
  const sessionRef = useRef<LiveSession | null>(null)
  const sinksRef = useRef(new Set<FrameSink>())
  const countersRef = useRef<FrameCounters>(freshCounters())
  const logIdRef = useRef(0)
  const consoleIdRef = useRef(0)
  const debugRef = useRef(debug)
  debugRef.current = debug

  const log = useCallback((level: SmokeLogLevel, label: string, detail?: unknown) => {
    if (!debugRef.current) {
      return
    }
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
  const journal = useJournalFeed(client, debug && hubConnected)

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
    if (!debug) {
      return
    }
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
  }, [debug])

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
        if (debugRef.current) {
          const line = lineFromConsoleOutput(message, ++consoleIdRef.current)
          if (line) {
            setConsoleLines((previous) => [...previous, line].slice(-SMOKE_LOG_LIMIT))
          }
          log('wire', 'console', message)
        }
      })
      session.on('notification', (notification) => {
        countersRef.current.notifications += 1
        countersRef.current.dirty = true
        log(notification.errorCode ? 'warn' : 'wire', 'notification', notification)
      })
      session.on('syncUrl', (url) => {
        const { display } = applySyncedBrowserUrl(url)
        setCurrentUrl(display)
        log('wire', 'syncUrl', { url, display })
      })
      session.on('redirect', (url) => {
        log('info', 'redirect', { url })
        if (url.startsWith('https:') || url.startsWith('http:')) {
          window.location.href = url
        }
      })
      session.on('ended', (event) => {
        log('warn', 'session ended', event)
      })
      if (session.lastSyncedUrl) {
        const { display } = applySyncedBrowserUrl(session.lastSyncedUrl)
        setCurrentUrl(display)
      }
      if (
        session.lastRedirectUrl &&
        (session.lastRedirectUrl.startsWith('https:') ||
          session.lastRedirectUrl.startsWith('http:'))
      ) {
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
    async (path: string, query = '') => {
      if (!(await connect())) {
        return
      }
      setPhase('starting')
      countersRef.current = freshCounters()
      setStats(EMPTY_STATS)
      setStatus(null)
      setConsoleLines([])
      consoleIdRef.current = 0
      try {
        const ensured = await client.ensureProfile(loadProfileId())
        saveProfileId(ensured.profileId)
        setProfileId(ensured.profileId)
        log('info', ensured.created ? 'profile created' : 'profile reused', ensured)

        const normalizedPath = path.startsWith('/') ? path : `/${path}`
        log('info', 'hub start…', {
          profileId: ensured.profileId,
          path: normalizedPath,
          query,
          transportOrigin: origins.transportOrigin || '(same origin)',
        })
        const session = await client.startSession({
          profileId: ensured.profileId,
          path: normalizedPath,
          query,
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

  const sendInput = useCallback(
    (input: SessionInput) => {
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
    },
    [log],
  )

  const pollStatus = useCallback(async () => {
    const session = sessionRef.current
    if (!session) {
      return
    }
    try {
      const snapshot = await session.getStatus()
      setStatus(snapshot)
      if (snapshot.url) {
        const { display } = applySyncedBrowserUrl(snapshot.url)
        setCurrentUrl(display)
      }
      log('wire', 'status', snapshot)
    } catch (error) {
      log('error', 'status failed', error)
    }
  }, [log])

  const navigate = useCallback(
    async (path: string, query = '') => {
      const session = sessionRef.current
      if (!session) {
        return
      }
      const normalizedPath = path.startsWith('/') ? path : `/${path}`
      log('info', 'navigate', { path: normalizedPath, query })
      try {
        await session.navigate({ path: normalizedPath, query })
      } catch (error) {
        log('error', 'navigate failed', error)
      }
    },
    [log],
  )

  const evaluate = useCallback(
    async (code: string): Promise<EvalResult | void> => {
      const session = sessionRef.current
      if (!session || !code.trim()) {
        return
      }
      log('info', 'evaluate', code)
      try {
        const result = await session.evaluate(code)
        log(result.ok ? 'wire' : 'warn', 'eval result', result)
        return result
      } catch (error) {
        log('error', 'evaluate failed', error)
        throw error
      }
    },
    [log],
  )

  const runConsoleCommand = useCallback(
    async (code: string) => {
      const trimmed = code.trim()
      if (!trimmed) {
        return
      }
      if (debugRef.current) {
        setConsoleLines((previous) =>
          [...previous, inputConsoleLine(++consoleIdRef.current, trimmed)].slice(
            -SMOKE_LOG_LIMIT,
          ),
        )
      }
      await evaluate(trimmed)
    },
    [evaluate],
  )

  const clearConsole = useCallback(() => {
    setConsoleLines([])
  }, [])

  const applyOrigins = useCallback(
    (next: SessionOrigins) => {
      if (!labOrigins) {
        return
      }
      saveLabOrigins(next)
      setOriginsState({
        hubOrigin: next.hubOrigin.trim().replace(/\/$/, ''),
        transportOrigin: next.transportOrigin.trim().replace(/\/$/, ''),
      })
      setPhase('idle')
      setConnectionId(null)
      setSessionId(null)
      log('info', 'origins updated', next)
    },
    [labOrigins, log],
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
    entries: debug ? entries : [],
    consoleLines: debug ? consoleLines : [],
    journal: debug ? journal : EMPTY_JOURNAL,
    stats: debug ? stats : EMPTY_STATS,
    status,
    isLive: phase === 'live',
    attachFrameSink,
    connect,
    start,
    stop,
    sendInput,
    pollStatus,
    navigate,
    evaluate,
    runConsoleCommand,
    clearConsole,
    applyOrigins,
    forgetProfile,
  }
}
