import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PageProjectionDiff,
  SessionClient,
  SessionConsoleOutput,
  SessionFrame,
  SessionNotification,
} from '@/lib/speculum'
import {
  formatFrontDebugDetail,
  observationAllowsPlane,
  type ClientObservationConfig,
  type FrontDebugLogEntry,
  type FrontDebugLogFields,
  type FrontDebugLogLevel,
} from '@/features/sessions/debug/frontDebugLog'
import { pageProjectionLagMs } from '@/features/sessions/live/dom/PageProjectionDiffApplier'
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
type PageProjectionDiffSink = (diff: PageProjectionDiff) => void
type PageProjectionLifecycleSink = (notification: SessionNotification) => void
type PageProjectionDiffEndedSink = (info: { reason: 'wire_stall' }) => void

export type PageProjectionApplierProbe = () => {
  generation: number
  lastSequence: number
  desynced: boolean
}

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
  const domDiffSinksRef = useRef(new Set<PageProjectionDiffSink>())
  const lifecycleSinksRef = useRef(new Set<PageProjectionLifecycleSink>())
  const diffEndedSinksRef = useRef(new Set<PageProjectionDiffEndedSink>())
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
      setEntries((previous) => [entry, ...previous])
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

  const attachPageProjectionDiffSink = useCallback((sink: PageProjectionDiffSink) => {
    domDiffSinksRef.current.add(sink)
    return () => {
      domDiffSinksRef.current.delete(sink)
    }
  }, [])

  const attachPageProjectionLifecycleSink = useCallback((sink: PageProjectionLifecycleSink) => {
    lifecycleSinksRef.current.add(sink)
    return () => {
      lifecycleSinksRef.current.delete(sink)
    }
  }, [])

  const attachPageProjectionDiffEndedSink = useCallback((sink: PageProjectionDiffEndedSink) => {
    diffEndedSinksRef.current.add(sink)
    return () => {
      diffEndedSinksRef.current.delete(sink)
    }
  }, [])

  const onPageProjectionLifecycle = useCallback((notification: SessionNotification) => {
    for (const sink of lifecycleSinksRef.current) {
      sink(notification)
    }
  }, [])

  const onPageProjectionDiffEnded = useCallback((info: { reason: 'wire_stall' }) => {
    for (const sink of diffEndedSinksRef.current) {
      sink(info)
    }
  }, [])

  const pageProjectionApplierProbeRef = useRef<PageProjectionApplierProbe | null>(null)
  const registerPageProjectionApplierProbe = useCallback((probe: PageProjectionApplierProbe | null) => {
    pageProjectionApplierProbeRef.current = probe
  }, [])
  const readPageProjectionApplierProbe = useCallback(() => {
    return pageProjectionApplierProbeRef.current?.() ?? null
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

  const onPageProjectionDiff = useCallback((diff: PageProjectionDiff) => {
    const tClient = performance.now()
    const plane = String(diff.plane ?? 'unknown')
    const operation = String(diff.operation ?? 'unknown')
    const generation = diff.generation != null ? Number(diff.generation) : null
    const sequence = diff.sequence != null ? Number(diff.sequence) : null
    const sidecarTs = diff.timestamp != null ? Number(diff.timestamp) : null
    const lagMs = pageProjectionLagMs(sidecarTs)
    // Sheet/rule walks are opt-in only — near-zero cost when ClientObservation Diff is off.
    let sheetExtra: Record<string, unknown> | undefined
    if (observationAllowsPlane(observationRef.current, 'pageProjectionDiff')) {
      const sheets = Array.isArray(diff.install?.sheets) ? diff.install!.sheets! : []
      if (sheets.length > 0) {
        let ruleCount = 0
        let seededSheetCount = 0
        for (const sheet of sheets) {
          const rules = sheet.rules ?? []
          ruleCount += rules.length
          if (rules.some((r) => String(r.id ?? '').startsWith('seed:'))) {
            seededSheetCount += 1
          }
        }
        sheetExtra = { sheetCount: sheets.length, ruleCount, seededSheetCount }
      }
    }
    trace(
      'wire',
      `page_projection ${plane}/${operation}`,
      {
        plane: 'pageProjectionDiff',
        hop: 'client_recv',
        kind: `${plane}:${operation}`,
        generation,
        sequence,
        tClient,
        lagMs,
        extra: {
          timestamp: sidecarTs,
          ...(sheetExtra ?? {}),
        },
      },
    )
    for (const sink of domDiffSinksRef.current) {
      sink(diff)
    }
  }, [observationRef, trace])

  const observePageProjectionDiffApply = useCallback(
    (event: {
      kind: string
      hop:
        | 'client_apply'
        | 'client_drop'
        | 'client_desync'
        | 'client_resync_request'
        | 'client_resync_apply'
        | 'client_arm'
        | 'client_epoch_arm'
        | 'client_disarm'
        | 'client_surface_probe'
        | 'programmaticSuppress'
        | `cssom/${string}`
        | (string & {})
      reason?: string
      generation?: number | null
      sequence?: number | null
      expectedSequence?: number | null
      remount?: boolean
      seeded?: boolean
      sheetCount?: number
      ruleCount?: number
      dropped?: boolean
      armed?: boolean
      timestamp?: number | null
      tClient?: number
      lagMs?: number | null
      level?: FrontDebugLogLevel
      target?: string | null
      extra?: Record<string, unknown>
    }) => {
      if (!observationAllowsPlane(observationRef.current, 'pageProjectionDiff')) {
        return
      }
      const tClient = event.tClient ?? performance.now()
      const lagMs =
        event.lagMs ?? pageProjectionLagMs(event.timestamp != null ? Number(event.timestamp) : null)
      const rawExtra = { ...(event.extra ?? {}) }
      const installSheets = rawExtra.installSheets
      delete rawExtra.installSheets
      // Promote miss locus to top-level fields (analyze + export SoT).
      const phaseFromExtra =
        typeof rawExtra.phase === 'string' ? (rawExtra.phase as string) : null
      delete rawExtra.phase
      const matchCount =
        typeof rawExtra.matchCount === 'number' ? (rawExtra.matchCount as number) : undefined
      let sheetCount = event.sheetCount
      let ruleCount = event.ruleCount
      let seeded = event.seeded
      if (Array.isArray(installSheets) && installSheets.length > 0) {
        sheetCount = installSheets.length
        ruleCount = 0
        let seededSheetCount = 0
        for (const sheet of installSheets as Array<{ rules?: Array<{ id?: string }> }>) {
          const rules = sheet.rules ?? []
          ruleCount += rules.length
          if (rules.some((r) => String(r.id ?? '').startsWith('seed:'))) {
            seededSheetCount += 1
          }
        }
        seeded = seededSheetCount > 0
        if (seededSheetCount > 0) rawExtra.seededSheetCount = seededSheetCount
      }
      trace(
        event.level ?? (event.hop === 'client_drop' || event.hop === 'client_desync' ? 'warn' : 'wire'),
        `page_projection ${event.hop}`,
        {
          plane: 'pageProjectionDiff',
          hop: event.hop,
          kind: event.kind,
          generation: event.generation ?? null,
          sequence: event.sequence ?? null,
          expectedSequence: event.expectedSequence ?? null,
          remount: event.remount,
          dropped: event.dropped,
          armed: event.armed,
          errorCode: event.reason ?? null,
          phase: phaseFromExtra,
          tClient,
          lagMs,
          extra: {
            ...(event.timestamp != null ? { timestamp: event.timestamp } : {}),
            ...(event.reason != null ? { reason: event.reason } : {}),
            ...(phaseFromExtra != null ? { phase: phaseFromExtra } : {}),
            ...(matchCount != null ? { matchCount } : {}),
            ...(seeded != null ? { seeded } : {}),
            ...(sheetCount != null ? { sheetCount } : {}),
            ...(ruleCount != null ? { ruleCount } : {}),
            ...(event.target != null ? { target: event.target } : {}),
            ...rawExtra,
          },
        },
      )
    },
    [observationRef, trace],
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
          setConsoleLines((previous) => [...previous, line])
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
        [...previous, inputConsoleLine(++consoleIdRef.current, code)],
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
    onPageProjectionDiff,
    attachFrameSink,
    attachPageProjectionDiffSink,
    attachPageProjectionLifecycleSink,
    attachPageProjectionDiffEndedSink,
    onPageProjectionLifecycle,
    onPageProjectionDiffEnded,
    observePageProjectionDiffApply,
    registerPageProjectionApplierProbe,
    readPageProjectionApplierProbe,
    bumpNotificationCounter,
    onSessionConsole,
    resetForStart,
    clearConsole,
    appendConsoleInput,
  }
}
