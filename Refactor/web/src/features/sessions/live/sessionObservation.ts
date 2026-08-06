import { useCallback, useEffect, useRef, useState } from 'react'
import type { DomDiff, SessionClient, SessionConsoleOutput, SessionFrame } from '@/lib/speculum'
import {
  FRONT_DEBUG_LOG_LIMIT,
  formatFrontDebugDetail,
  observationAllowsPlane,
  type ClientObservationConfig,
  type FrontDebugLogEntry,
  type FrontDebugLogFields,
  type FrontDebugLogLevel,
} from '@/features/sessions/debug/frontDebugLog'
import {
  inputConsoleLine,
  lineFromConsoleOutput,
  type LabConsoleLine,
} from '@/features/sessions/lab/labConsole'
import { useJournalFeed, type JournalFeed } from '@/features/sessions/lab/useJournalFeed'
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

export const EMPTY_STATS: LiveSessionStats = {
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

export const EMPTY_JOURNAL: JournalFeed = {
  facts: [],
  error: null,
  streaming: false,
  clear: () => {},
}

type FrameSink = (frame: SessionFrame) => void
type DomDiffSink = (diff: DomDiff) => void

export interface FrameCounters {
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

export function freshCounters(): FrameCounters {
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

export interface UseSessionObservationOptions {
  debug: boolean
  client: SessionClient
  hubConnected: boolean
  sessionIdRef: React.MutableRefObject<string | null>
  observationRef: React.MutableRefObject<ClientObservationConfig>
}

export function useSessionObservation({
  debug,
  client,
  hubConnected,
  sessionIdRef,
  observationRef,
}: UseSessionObservationOptions) {
  const [entries, setEntries] = useState<FrontDebugLogEntry[]>([])
  const [consoleLines, setConsoleLines] = useState<LabConsoleLine[]>([])
  const [stats, setStats] = useState<LiveSessionStats>(EMPTY_STATS)

  const sinksRef = useRef(new Set<FrameSink>())
  const domDiffSinksRef = useRef(new Set<DomDiffSink>())
  const countersRef = useRef<FrameCounters>(freshCounters())
  const logIdRef = useRef(0)
  const consoleIdRef = useRef(0)
  const debugRef = useRef(debug)
  debugRef.current = debug

  const journal = useJournalFeed(client, debug && hubConnected)

  const trace = useCallback(
    (
      level: FrontDebugLogLevel,
      label: string,
      fields?: FrontDebugLogFields,
      detail?: unknown,
    ) => {
      const observation = observationRef.current
      if (!observationAllowsPlane(observation, fields?.plane ?? 'session')) {
        return
      }
      const entry: FrontDebugLogEntry = {
        id: ++logIdRef.current,
        at: Date.now(),
        level,
        label,
        fields: {
          ...fields,
          sessionId: fields?.sessionId ?? sessionIdRef.current,
          tClient: fields?.tClient ?? performance.now(),
        },
        detail: formatFrontDebugDetail(
          {
            ...fields,
            sessionId: fields?.sessionId ?? sessionIdRef.current,
            tClient: fields?.tClient ?? performance.now(),
          },
          detail,
        ),
      }
      setEntries((previous) => [entry, ...previous].slice(0, FRONT_DEBUG_LOG_LIMIT))
    },
    [observationRef, sessionIdRef],
  )

  const log = useCallback((level: FrontDebugLogLevel, label: string, detail?: unknown) => {
    trace(level, label, { plane: 'session', hop: 'lifecycle' }, detail)
  }, [trace])

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

  const attachDomDiffSink = useCallback((sink: DomDiffSink) => {
    domDiffSinksRef.current.add(sink)
    return () => {
      domDiffSinksRef.current.delete(sink)
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

  const onDomDiff = useCallback((diff: DomDiff) => {
    const tClient = performance.now()
    const kind = String(diff.kind ?? 'unknown')
    const generation = diff.generation != null ? Number(diff.generation) : null
    const sequence = diff.sequence != null ? Number(diff.sequence) : null
    const nodeCount = Array.isArray(diff.nodes) ? diff.nodes.length : undefined
    const urlCount = Array.isArray(diff.urls) ? diff.urls.length : undefined
    const sidecarTs = diff.timestamp != null ? Number(diff.timestamp) : null
    const lagMs =
      sidecarTs != null && Number.isFinite(sidecarTs) ? tClient - sidecarTs : null
    trace(
      'wire',
      `dom_diff ${kind}`,
      {
        plane: 'domProjectionDiff',
        hop: 'client_recv',
        kind,
        generation,
        sequence,
        tClient,
        lagMs,
        extra: {
          treeType: diff.treeType ?? null,
          nodeCount: nodeCount ?? null,
          urlCount: urlCount ?? null,
          timestamp: sidecarTs,
        },
      },
    )
    for (const sink of domDiffSinksRef.current) {
      sink(diff)
    }
  }, [trace])

  const observeDomDiffApply = useCallback(
    (event: {
      kind: string
      hop: 'client_apply' | 'client_drop'
      reason?: 'sequence_gap' | 'generation_mismatch'
      generation?: number | null
      sequence?: number | null
      expectedSequence?: number | null
      remount?: boolean
      dropped?: boolean
      timestamp?: number | null
      tClient?: number
      lagMs?: number | null
      level?: FrontDebugLogLevel
    }) => {
      const tClient = event.tClient ?? performance.now()
      const lagMs =
        event.lagMs ??
        (event.timestamp != null && Number.isFinite(event.timestamp)
          ? tClient - Number(event.timestamp)
          : null)
      trace(
        event.level ?? (event.hop === 'client_drop' ? 'warn' : 'wire'),
        `dom_diff ${event.hop}`,
        {
          plane: 'domProjectionDiff',
          hop: event.hop,
          kind: event.kind,
          generation: event.generation ?? null,
          sequence: event.sequence ?? null,
          expectedSequence: event.expectedSequence ?? null,
          remount: event.remount,
          dropped: event.dropped,
          tClient,
          lagMs,
          extra: {
            ...(event.timestamp != null ? { timestamp: event.timestamp } : {}),
            ...(event.reason != null ? { reason: event.reason } : {}),
          },
        },
      )
    },
    [trace],
  )

  const bumpNotificationCounter = useCallback(() => {
    countersRef.current.notifications += 1
    countersRef.current.dirty = true
  }, [])

  const onSessionConsole = useCallback(
    (message: SessionConsoleOutput) => {
      countersRef.current.consoleMessages += 1
      countersRef.current.dirty = true
      if (debugRef.current) {
        const line = lineFromConsoleOutput(message, ++consoleIdRef.current)
        if (line) {
          setConsoleLines((previous) => [...previous, line].slice(-FRONT_DEBUG_LOG_LIMIT))
        }
        log('wire', 'console', message)
      }
    },
    [log],
  )

  const resetForStart = useCallback(() => {
    countersRef.current = freshCounters()
    setStats(EMPTY_STATS)
    setConsoleLines([])
    consoleIdRef.current = 0
  }, [])

  const clearConsole = useCallback(() => {
    setConsoleLines([])
  }, [])

  const appendConsoleInput = useCallback((code: string) => {
    if (debugRef.current) {
      setConsoleLines((previous) =>
        [...previous, inputConsoleLine(++consoleIdRef.current, code)].slice(
          -FRONT_DEBUG_LOG_LIMIT,
        ),
      )
    }
  }, [])

  return {
    entries,
    consoleLines,
    stats,
    journal,
    countersRef,
    debugRef,
    consoleIdRef,
    trace,
    log,
    onFrame,
    onDomDiff,
    attachFrameSink,
    attachDomDiffSink,
    observeDomDiffApply,
    bumpNotificationCounter,
    onSessionConsole,
    resetForStart,
    clearConsole,
    appendConsoleInput,
  }
}
