import { useEffect, useMemo, useRef, useState } from 'react'
import { createSessionClient } from '@/lib/speculum'
import type { EditingState, SessionStatus } from '@/lib/speculum'
import type { CanvasSize } from './CanvasViewportSync'
import { loadEnvOrigins, loadProfileId, type SessionOrigins } from './sessionConfig'
import { useSessionPreStart, type LiveSessionPhase, type LiveSessionViewport } from './sessionPreStart'
import {
  EMPTY_JOURNAL,
  EMPTY_STATS,
  useSessionObservation,
  type LiveSessionStats,
} from './sessionObservation'
import { useSessionLifecycle } from './sessionLifecycle'

export type { LiveSessionPhase, LiveSessionStats, LiveSessionViewport }

export interface UseLiveSessionOptions {
  /**
   * Fallback viewport when the canvas has not laid out yet (e.g. first paint).
   * StartSession prefers the measured canvas size when available.
   */
  viewport: LiveSessionViewport
  /**
   * Lab observation chrome: Journal stream, console feed, stats tick.
   * Front Activity ring + Dom/Video hops are gated by Telemetry.ClientObservation
   * (public client-config) — same contract as Live.
   */
  debug?: boolean
}

/**
 * Shared session controller for lab and immersive live.
 * One path: createSessionClient → EnsureProfile → StartSession → DataStreams
 * (WebTransport or WebSocket from client-config) → NavigateAsync → hub.
 */
export function useLiveSession({
  viewport,
  debug = false,
}: UseLiveSessionOptions) {
  const [origins] = useState<SessionOrigins>(() => loadEnvOrigins())
  const [phase, setPhase] = useState<LiveSessionPhase>('idle')
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<string | null>(() => loadProfileId())
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [touchPrimary, setTouchPrimary] = useState(false)
  /** Client DPR from StartSession device profile (canvas encode buffer). */
  const [deviceScaleFactor, setDeviceScaleFactor] = useState(1)
  /** Bumps on each Keyboard tap so SessionViewport can re-focus IME after dismiss. */
  const [keyboardNonce, setKeyboardNonce] = useState(0)
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  /** Path+query wire from last SyncUrl/status — navigate when the bar display is untouched. */
  const [navigateHref, setNavigateHref] = useState<string | null>(null)
  /** Confirmed remote session viewport (StartSession / ResizeApplied). */
  const [remoteViewport, setRemoteViewport] = useState<LiveSessionViewport>(viewport)

  const canvasLayoutRef = useRef<CanvasSize>({
    width: viewport.width,
    height: viewport.height,
  })
  const sessionRef = useRef<import('@/lib/speculum').LiveSession | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  const preStart = useSessionPreStart({
    canvasLayoutRef,
    sessionRef,
    phaseRef,
  })

  const client = useMemo(() => {
    const created = createSessionClient({
      baseUrl: origins.hubOrigin,
      transportBaseUrl: origins.transportOrigin,
    })
    return created
  }, [origins.hubOrigin, origins.transportOrigin])

  const hubConnected = phase !== 'idle' && phase !== 'connecting'

  const observation = useSessionObservation({
    debug,
    client,
    hubConnected,
    sessionIdRef,
    observationRef: preStart.observationRef,
  })

  const lifecycle = useSessionLifecycle({
    client,
    origins,
    viewport,
    canvasLayoutRef,
    sessionRef,
    mirrorModeRef: preStart.mirrorModeRef,
    clientConfigLoadRef: preStart.clientConfigLoadRef,
    loadClientConfig: preStart.loadClientConfig,
    countersRef: observation.countersRef,
    debugRef: observation.debugRef,
    trace: observation.trace,
    log: observation.log,
    onFrame: observation.onFrame,
    onPageProjectionDiff: observation.onPageProjectionDiff,
    bumpNotificationCounter: observation.bumpNotificationCounter,
    onPageProjectionLifecycle: observation.onPageProjectionLifecycle,
    onPageProjectionDiffEnded: observation.onPageProjectionDiffEnded,
    onSessionConsole: observation.onSessionConsole,
    resetForStart: observation.resetForStart,
    appendConsoleInput: observation.appendConsoleInput,
    readPageProjectionApplierProbe: observation.readPageProjectionApplierProbe,
    setPhase,
    setConnectionId,
    setProfileId,
    setSessionId,
    setSessionToken,
    setTouchPrimary,
    setDeviceScaleFactor,
    setRemoteViewport,
    setEditing,
    setKeyboardNonce,
    setCurrentUrl,
    setNavigateHref,
    setStatus,
  })

  useEffect(() => {
    const disposers = [
      client.on('hubClose', (error) => {
        observation.log('warn', 'hub closed', error)
        setPhase('idle')
        setConnectionId(null)
        setSessionId(null)
      }),
      client.on('hubReconnecting', () => observation.log('warn', 'hub reconnecting')),
      client.on('hubReconnected', () => observation.log('info', 'hub reconnected')),
    ]
    return () => {
      for (const dispose of disposers) {
        dispose()
      }
      void client.disconnect()
    }
  }, [client, observation.log])

  // Diagnostics: expose front Activity ring for Playwright / Cursor smoke export
  // when ClientObservation is on (same ring as SessionObservationChrome).
  useEffect(() => {
    if (!preStart.clientObservation.isEnabled && !debug) {
      return
    }
    const w = window as Window & {
      __speculumFrontDebugLog?: unknown
      __speculumExportFrontDebugJsonl?: unknown
      __speculumSessionId?: string | null
    }
    w.__speculumSessionId = sessionId
    w.__speculumFrontDebugLog = () =>
      observation.entries
        .slice()
        .reverse()
        .map((e) => ({
          id: e.id,
          at: e.at,
          level: e.level,
          label: e.label,
          detail: e.detail,
          fields: e.fields,
        }))
    w.__speculumExportFrontDebugJsonl = () => {
      const rows = (
        typeof w.__speculumFrontDebugLog === 'function' ? w.__speculumFrontDebugLog() : []
      ) as unknown[]
      return rows.map((row) => JSON.stringify(row)).join('\n')
    }
    return () => {
      delete w.__speculumFrontDebugLog
      delete w.__speculumExportFrontDebugJsonl
      delete w.__speculumSessionId
    }
  }, [
    debug,
    preStart.clientObservation.isEnabled,
    observation.entries,
    sessionId,
  ])

  return {
    phase,
    origins,
    connectionId,
    profileId,
    sessionId,
    sessionToken,
    mirrorMode: preStart.mirrorMode,
    currentUrl,
    navigateHref,
    entries: preStart.clientObservation.isEnabled || debug ? observation.entries : [],
    clientObservation: preStart.clientObservation,
    refreshClientConfig: preStart.loadClientConfig,
    consoleLines: debug ? observation.consoleLines : [],
    journal: debug ? observation.journal : EMPTY_JOURNAL,
    stats: debug ? observation.stats : EMPTY_STATS,
    status,
    editing,
    touchPrimary,
    deviceScaleFactor,
    screencastMaxEncodeScale: preStart.screencastMaxEncodeScale,
    keyboardNonce,
    openKeyboard: lifecycle.openKeyboard,
    isLive: phase === 'live',
    remoteViewport,
    viewportPolicy: preStart.viewportPolicy,
    attachFrameSink: observation.attachFrameSink,
    attachPageProjectionDiffSink: observation.attachPageProjectionDiffSink,
    attachPageProjectionLifecycleSink: observation.attachPageProjectionLifecycleSink,
    attachPageProjectionDiffEndedSink: observation.attachPageProjectionDiffEndedSink,
    observePageProjectionDiffApply: observation.observePageProjectionDiffApply,
    registerPageProjectionApplierProbe: observation.registerPageProjectionApplierProbe,
    connect: lifecycle.connect,
    start: lifecycle.start,
    stop: lifecycle.stop,
    sendInput: lifecycle.sendInput,
    sendDomInput: lifecycle.sendDomInput,
    onCanvasLayout: lifecycle.onCanvasLayout,
    onRemoteViewportApplied: lifecycle.onRemoteViewportApplied,
    requestRemoteResize: lifecycle.requestRemoteResize,
    pollStatus: lifecycle.pollStatus,
    navigate: lifecycle.navigate,
    evaluate: lifecycle.evaluate,
    runConsoleCommand: lifecycle.runConsoleCommand,
    clearConsole: observation.clearConsole,
    forgetProfile: lifecycle.forgetProfile,
  }
}
