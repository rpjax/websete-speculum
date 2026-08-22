import { useCallback } from 'react'
import {
  invalidateClientConfigCache,
  isPendingConfigError,
  requireOperationalSessionsConfig,
  type ClientConfig,
} from '@/lib/clientConfig'
import {
  normalizeDataStreamTransportKind,
  newInputTraceId,
  NotificationKind,
} from '@/lib/speculum'
import type {
  PageProjectionIntent,
  EditingState,
  EvalResult,
  LiveSession,
  SessionClient,
  SessionInput,
  SessionStatus,
} from '@/lib/speculum'
import {
  detectDeviceProfile,
  isTouchPrimaryProfile,
} from '@/features/sessions/live/deviceProfile'
import { syncClientLocation } from '@/features/sessions/live/syncClientLocation'
import type { CanvasSize } from './CanvasViewportSync'
import type { LiveSessionPhase, LiveSessionViewport } from './sessionPreStart'
import {
  clearProfileId,
  loadProfileId,
  saveProfileId,
  type SessionOrigins,
} from './sessionConfig'
import { resolveDataStreamForPage } from './resolveDataStream'
import { applySyncedBrowserUrl } from './sessionUrlSync'
import { detectClientEnvironment } from './detectClientEnvironment'
import type { LayoutWaiter } from './layoutWaiter'
import type { FrameCounters } from './sessionObservation'
import type {
  FrontDebugLogFields,
  FrontDebugLogLevel,
} from '@/features/sessions/debug/frontDebugLog'

export interface UseSessionLifecycleOptions {
  client: SessionClient
  origins: SessionOrigins
  viewport: LiveSessionViewport
  canvasLayoutRef: React.MutableRefObject<CanvasSize>
  layoutWaiter: LayoutWaiter
  sessionRef: React.MutableRefObject<LiveSession | null>
  mirrorModeRef: React.MutableRefObject<import('@/lib/speculum').MirrorMode>
  clientConfigLoadRef: React.MutableRefObject<Promise<ClientConfig | null> | null>
  loadClientConfig: (force?: boolean) => Promise<ClientConfig | null>
  countersRef: React.MutableRefObject<FrameCounters>
  debugRef: React.MutableRefObject<boolean>
  trace: (
    level: FrontDebugLogLevel,
    label: string,
    fields?: FrontDebugLogFields,
    detail?: unknown,
  ) => void
  log: (level: FrontDebugLogLevel, label: string, detail?: unknown) => void
  onFrame: (frame: import('@/lib/speculum').SessionFrame) => void
  onPageProjectionFrame: (diff: import('@/lib/speculum').PageProjectionFrame) => void
  bumpNotificationCounter: () => void
  onPageProjectionLifecycle: (notification: import('@/lib/speculum').SessionNotification) => void
  onPageProjectionFrameEnded: (info: { reason: 'wire_stall' }) => void
  onSessionConsole: (message: import('@/lib/speculum').SessionConsoleOutput) => void
  resetForStart: () => void
  appendConsoleInput: (code: string) => void
  readPageProjectionApplierProbe?: () => {
    generation: number
    lastSequence: number
    desynced: boolean
  } | null
  setPhase: React.Dispatch<React.SetStateAction<LiveSessionPhase>>
  setConnectionId: React.Dispatch<React.SetStateAction<string | null>>
  setProfileId: React.Dispatch<React.SetStateAction<string | null>>
  setSessionId: React.Dispatch<React.SetStateAction<string | null>>
  setSessionToken: React.Dispatch<React.SetStateAction<string | null>>
  setTouchPrimary: React.Dispatch<React.SetStateAction<boolean>>
  setDeviceScaleFactor: React.Dispatch<React.SetStateAction<number>>
  setRemoteViewport: React.Dispatch<React.SetStateAction<LiveSessionViewport>>
  setEditing: React.Dispatch<React.SetStateAction<EditingState | null>>
  setKeyboardNonce: React.Dispatch<React.SetStateAction<number>>
  setCurrentUrl: React.Dispatch<React.SetStateAction<string | null>>
  setNavigateHref: React.Dispatch<React.SetStateAction<string | null>>
  setStatus: React.Dispatch<React.SetStateAction<SessionStatus | null>>
}

export function useSessionLifecycle({
  client,
  origins,
  viewport,
  canvasLayoutRef,
  layoutWaiter,
  sessionRef,
  mirrorModeRef,
  clientConfigLoadRef,
  loadClientConfig,
  countersRef,
  debugRef,
  trace,
  log,
  onFrame,
  onPageProjectionFrame,
  bumpNotificationCounter,
  onPageProjectionLifecycle,
  onPageProjectionFrameEnded,
  onSessionConsole,
  resetForStart,
  appendConsoleInput,
  readPageProjectionApplierProbe,
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
}: UseSessionLifecycleOptions) {
  const bind = useCallback(
    (session: LiveSession) => {
      sessionRef.current = session
      session.on('frame', onFrame)
      session.on('pageProjectionFrame', onPageProjectionFrame)
      session.on('pageProjectionFrameEnded', onPageProjectionFrameEnded)
      session.on('pageProjectionFrameRejected', (rej) => {
        log('warn', 'page_projection normalize_rejected', {
          plane: 'pageProjectionFrame',
          hop: 'client_drop',
          reason: 'client_normalize_rejected',
          rejectReason: rej.reason,
          sequence: rej.sequence,
          generation: rej.generation,
          planeName: rej.plane,
          operation: rej.operation,
        })
        trace('warn', 'page_projection normalize_rejected', {
          plane: 'pageProjectionFrame',
          hop: 'client_drop',
          kind: 'client_normalize_rejected',
          sequence: rej.sequence,
          generation: rej.generation,
          errorCode: 'client_normalize_rejected',
          extra: {
            reason: 'client_normalize_rejected',
            rejectReason: rej.reason,
            plane: rej.plane,
            operation: rej.operation,
          },
        })
      })
      session.on('console', onSessionConsole)
      session.on('notification', (notification) => {
        bumpNotificationCounter()
        if (notification.kind === NotificationKind.EditableFocusChanged) {
          setEditing(notification.editing ?? null)
        }
        if (notification.kind === NotificationKind.PageProjectionLifecycle) {
          onPageProjectionLifecycle(notification)
        }
        log(notification.errorCode ? 'warn' : 'wire', 'notification', notification)
      })
      session.on('syncUrl', (url) => {
        const { display, clientHref } = applySyncedBrowserUrl(url)
        setCurrentUrl(display)
        setNavigateHref(clientHref)
        // Live catch-all: mirror remote path into the operator address bar.
        if (!debugRef.current) {
          syncClientLocation(url, false)
        }
        const probe = readPageProjectionApplierProbe?.() ?? null
        // Observe-only soft-nav correlation: gen/seq/desync on SyncUrl (not a Dom remount trigger).
        trace(
          'wire',
          'syncUrl',
          {
            plane: 'session',
            hop: 'syncUrl',
            pageProjectionGeneration: probe?.generation ?? null,
            pageProjectionLastSequence: probe?.lastSequence ?? null,
            pageProjectionDesynced: probe?.desynced ?? null,
          },
          { url, display, clientHref },
        )
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
        const { display, clientHref } = applySyncedBrowserUrl(session.lastSyncedUrl)
        setCurrentUrl(display)
        setNavigateHref(clientHref)
        if (!debugRef.current) {
          syncClientLocation(session.lastSyncedUrl, false)
        }
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
          setSessionToken(null)
          // mirrorMode / viewportPolicy stay as configured — they describe the next
          // start, not the session that just ended.
          setEditing(null)
          setKeyboardNonce(0)
          setPhase(client.isConnected ? 'connected' : 'idle')
        }
        log('info', 'session closed')
      })
    },
    [
      bumpNotificationCounter,
      client,
      debugRef,
      log,
      onPageProjectionFrame,
      onPageProjectionLifecycle,
      onPageProjectionFrameEnded,
      onFrame,
      onSessionConsole,
      readPageProjectionApplierProbe,
      sessionRef,
      setEditing,
      setKeyboardNonce,
      setNavigateHref,
      setCurrentUrl,
      setPhase,
      setSessionId,
      setSessionToken,
      trace,
    ],
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
      setPhase('error')
      log('error', 'hub connect failed', error)
      return false
    }
  }, [client, log, setConnectionId, setPhase])

  const start = useCallback(
    async (path: string, query = '') => {
      if (!(await connect())) {
        return
      }
      setPhase('starting')
      resetForStart()
      setStatus(null)
      try {
        const ensured = await client.ensureProfile(loadProfileId())
        saveProfileId(ensured.profileId)
        setProfileId(ensured.profileId)
        log('info', ensured.created ? 'profile created' : 'profile ensure existing', ensured)

        const normalizedPath = path.startsWith('/') ? path : `/${path}`
        const device = detectDeviceProfile()
        const primary = isTouchPrimaryProfile(device)
        setTouchPrimary(primary)
        setDeviceScaleFactor(device.deviceScaleFactor)
        // Settle the mirror surface FIRST: client-config decides which surface mounts,
        // and only then is the host measured. Measuring before the surface is final
        // was what forced a corrective ResizeAsync right after start.
        const config = await (clientConfigLoadRef.current ?? loadClientConfig())
        if (config) {
          requireOperationalSessionsConfig(config)
        }
        const configuredMirrorMode = mirrorModeRef.current
        // Let React commit the definitive mirror surface after any mode swap, then wait for layout.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
        const layout = await layoutWaiter.wait(3000)
        if (!layout) {
          setPhase('error')
          log('error', 'mirror surface has no layout — refusing StartSession')
          return
        }
        const viewportWidth = layout.width
        const viewportHeight = layout.height
        log('info', 'hub start…', {
          profileId: ensured.profileId,
          path: normalizedPath,
          query,
          transportOrigin: origins.transportOrigin || '(same origin)',
          device,
          viewport: { width: viewportWidth, height: viewportHeight },
        })
        // Default webTransport when client-config is unreachable.
        const configured = normalizeDataStreamTransportKind(
          config?.sessions?.dataStreamTransport,
        )
        const resolved = resolveDataStreamForPage({
          configured,
          hubOrigin: origins.hubOrigin,
          transportOrigin: origins.transportOrigin,
        })
        client.applyDataStreamConfig({
          dataStreamTransport: resolved.kind,
          transportBaseUrl: resolved.transportBaseUrl,
        })
        log('info', 'data stream transport', {
          dataStreamTransport: resolved.kind,
          transportBaseUrl: resolved.transportBaseUrl || '(same origin)',
        })
        const session = await client.startSession({
          profileId: ensured.profileId,
          path: normalizedPath,
          query,
          viewportWidth,
          viewportHeight,
          device,
          clientEnvironment: detectClientEnvironment(),
        })
        // The Start response is an ack: identity + binding token. Mirror mode and
        // viewport policy already came from client-config. A mismatch means an
        // operator changed Sessions between page load and Start, so the mounted
        // surface cannot paint this session — fail closed instead of hot-swapping
        // the surface (which is what forced a corrective resize).
        if (session.mirrorMode !== configuredMirrorMode) {
          log('error', 'mirror mode mismatch — refusing to swap the mounted surface', {
            configured: configuredMirrorMode,
            session: session.mirrorMode,
          })
          invalidateClientConfigCache()
          void loadClientConfig(true)
          try {
            await session.stop()
          } catch {
            /* already gone */
          }
          setPhase('error')
          return
        }
        bind(session)
        setSessionId(session.sessionId)
        setSessionToken(session.token)
        setRemoteViewport({ width: viewportWidth, height: viewportHeight })
        setEditing(null)
        setKeyboardNonce(0)
        setPhase('live')
        log('info', 'session live', {
          sessionId: session.sessionId,
          touchPrimary: primary,
          mirrorMode: session.mirrorMode,
        })
      } catch (error) {
        if (isPendingConfigError(error)) {
          window.location.replace('/w7s/setup')
          return
        }
        setPhase('error')
        log('error', 'start failed', error)
      }
    },
    [
      bind,
      canvasLayoutRef,
      layoutWaiter,
      client,
      clientConfigLoadRef,
      connect,
      loadClientConfig,
      log,
      mirrorModeRef,
      origins.hubOrigin,
      origins.transportOrigin,
      resetForStart,
      setDeviceScaleFactor,
      setEditing,
      setKeyboardNonce,
      setPhase,
      setProfileId,
      setRemoteViewport,
      setSessionId,
      setSessionToken,
      setStatus,
      setTouchPrimary,
      viewport.height,
      viewport.width,
    ],
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
      setSessionToken(null)
      // mirrorMode / viewportPolicy / encode scale come from client-config, not from
      // the session — keep them so the next start measures the same surface.
      setEditing(null)
      setKeyboardNonce(0)
      setDeviceScaleFactor(1)
      setCurrentUrl(null)
      setNavigateHref(null)
      setPhase(client.isConnected ? 'connected' : 'idle')
    }
  }, [
    client,
    log,
    sessionRef,
    setCurrentUrl,
    setDeviceScaleFactor,
    setEditing,
    setKeyboardNonce,
    setNavigateHref,
    setPhase,
    setSessionId,
    setSessionToken,
  ])

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
      const traceId = newInputTraceId()
      const clientTimestampMs = Date.now()
      trace(
        'wire',
        'video_input client_sent',
        {
          plane: 'videoStreamingInput',
          hop: 'client_sent',
          kind: input.type,
          tClient: counters.lastInputAt,
          traceId,
          extra: { clientTimestampMs },
        },
      )
      void session.sendInput({ ...input, traceId, clientTimestampMs }).catch((error: unknown) => {
        trace(
          'error',
          `video_input ${input.type} failed`,
          {
            plane: 'videoStreamingInput',
            hop: 'client_sent',
            kind: input.type,
            traceId,
            errorCode: 'send_failed',
          },
          error,
        )
      })
    },
    [countersRef, sessionRef, trace],
  )

  const sendDomInput = useCallback(
    (input: PageProjectionIntent) => {
      const session = sessionRef.current
      if (!session) {
        return
      }
      const counters = countersRef.current
      counters.inputsSent += 1
      counters.lastInputType = input.type
      counters.lastInputAt = performance.now()
      counters.dirty = true
      const traceId = input.traceId?.trim() || newInputTraceId()
      const timestampClient = input.timestampClient ?? counters.lastInputAt
      let scrollExtra: Record<string, unknown> | undefined
      if (
        input.type === 'scrollViewport'
        || input.type === 'scrollElement'
        || input.type === 'wheel'
        || input.type === 'keydown'
        || input.type === 'keyup'
        || input.type === 'value'
      ) {
        try {
          const payload = JSON.parse(input.payload || '{}') as Record<string, unknown>
          scrollExtra = {
            scrollX: payload.scrollX ?? null,
            scrollY: payload.scrollY ?? null,
            scrollTop: payload.scrollTop ?? null,
            scrollLeft: payload.scrollLeft ?? null,
            key: payload.key ?? null,
            valueLen: typeof payload.value === 'string' ? payload.value.length : null,
          }
        } catch {
          scrollExtra = undefined
        }
      }
      trace(
        'wire',
        'dom_input client_sent',
        {
          plane: 'pageProjectionIntent',
          hop: 'client_sent',
          kind: input.type,
          generation: input.generation,
          anchor: input.anchor ?? null,
          tClient: counters.lastInputAt,
          traceId,
          ...scrollExtra,
        },
      )
      void session
        .sendPageProjectionIntent({ ...input, traceId, timestampClient })
        .catch((error: unknown) => {
          trace(
            'error',
            `dom_input ${input.type} failed`,
            {
              plane: 'pageProjectionIntent',
              hop: 'client_sent',
              kind: input.type,
              generation: input.generation,
              anchor: input.anchor ?? null,
              traceId,
              errorCode: 'send_failed',
            },
            error,
          )
        })
    },
    [countersRef, sessionRef, trace],
  )

  const onCanvasLayout = useCallback((size: CanvasSize) => {
    layoutWaiter.report(size)
  }, [layoutWaiter])

  const onRemoteViewportApplied = useCallback((size: CanvasSize) => {
    setRemoteViewport({ width: size.width, height: size.height })
    log('info', 'remote viewport applied', size)
  }, [log, setRemoteViewport])

  const requestRemoteResize = useCallback(
    async (
      size: CanvasSize,
      device: import('@/lib/speculum').SessionDeviceProfile,
    ) => {
      const session = sessionRef.current
      if (!session) {
        return {
          applied: false,
          width: size.width,
          height: size.height,
          errorCode: 'session_gone',
          message: 'No live session',
        }
      }
      log('info', 'resize…', size)
      return session.resize({
        width: size.width,
        height: size.height,
        device,
      })
    },
    [log, sessionRef],
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
        const { display, clientHref } = applySyncedBrowserUrl(snapshot.url)
        setCurrentUrl(display)
        setNavigateHref(clientHref)
      }
      log('wire', 'status', snapshot)
    } catch (error) {
      log('error', 'status failed', error)
    }
  }, [log, sessionRef, setCurrentUrl, setNavigateHref, setStatus])

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
    [log, sessionRef],
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
    [log, sessionRef],
  )

  const runConsoleCommand = useCallback(
    async (code: string) => {
      const trimmed = code.trim()
      if (!trimmed) {
        return
      }
      appendConsoleInput(trimmed)
      await evaluate(trimmed)
    },
    [appendConsoleInput, evaluate],
  )

  const forgetProfile = useCallback(() => {
    clearProfileId()
    setProfileId(null)
    log('info', 'profile forgotten — next start creates a new one')
  }, [log, setProfileId])

  const openKeyboard = useCallback(() => {
    setKeyboardNonce((n) => n + 1)
  }, [setKeyboardNonce])

  return {
    connect,
    start,
    stop,
    bind,
    sendInput,
    sendDomInput,
    onCanvasLayout,
    onRemoteViewportApplied,
    requestRemoteResize,
    pollStatus,
    navigate,
    evaluate,
    runConsoleCommand,
    forgetProfile,
    openKeyboard,
  }
}
