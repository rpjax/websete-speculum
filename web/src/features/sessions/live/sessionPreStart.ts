import { useCallback, useEffect, useRef, useState } from 'react'
import type { MirrorMode } from '@/lib/speculum'
import {
  fetchClientConfig,
  normalizeMirrorMode,
  readSessionViewportPolicy,
  type ClientConfig,
} from '@/lib/clientConfig'
import { API_URL } from '@/lib/env'
import {
  EMPTY_CLIENT_OBSERVATION,
  parseClientObservation,
  type ClientObservationConfig,
} from '@/features/sessions/debug/frontDebugLog'
import type { LiveSession } from '@/lib/speculum'
import type { SessionViewportBounds } from './sessionViewportPolicy'
import type { LayoutWaiter } from './layoutWaiter'

export type LiveSessionPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'starting'
  | 'live'
  | 'stopping'
  | 'error'

export interface LiveSessionViewport {
  width: number
  height: number
}

export interface UseSessionPreStartOptions {
  layoutWaiter: LayoutWaiter
  sessionRef: React.MutableRefObject<LiveSession | null>
  phaseRef: React.MutableRefObject<LiveSessionPhase>
}

export function useSessionPreStart({
  layoutWaiter,
  sessionRef,
  phaseRef,
}: UseSessionPreStartOptions) {
  /**
   * Sessions.MirrorMode from client-config — decided BEFORE StartSession so the
   * definitive surface is the one measured. Never driven by the Start response.
   */
  const [mirrorMode, setMirrorMode] = useState<MirrorMode>('pageProjection')
  /** Sessions.ScreencastPolicy.MaxEncodeScale from client-config. */
  const [screencastMaxEncodeScale, setScreencastMaxEncodeScale] = useState(2)
  /** Telemetry.ClientObservation from public client-config. */
  const [clientObservation, setClientObservation] = useState<ClientObservationConfig>(
    () => ({ ...EMPTY_CLIENT_OBSERVATION }),
  )
  /** Sessions.ViewportPolicy from client-config — drives client resize validation. */
  const [viewportPolicy, setViewportPolicy] = useState<SessionViewportBounds | null>(null)

  const observationRef = useRef(clientObservation)
  observationRef.current = clientObservation
  /** Configured surface, readable synchronously inside start/apply. */
  const mirrorModeRef = useRef<MirrorMode>(mirrorMode)
  mirrorModeRef.current = mirrorMode

  /**
   * Seed every pre-Start setting from client-config: the mirror surface, the
   * viewport policy used to validate geometry, the encode scale and the front
   * observation planes. Idempotent — the mount effect and `start` both call it.
   * While a session is live/starting, mirrorMode is frozen (no mid-session remount).
   */
  const applyClientConfig = useCallback((config: ClientConfig) => {
    setClientObservation(parseClientObservation(config.telemetry?.clientObservation))
    const scale = Number(config.sessions?.screencastMaxEncodeScale)
    if (Number.isFinite(scale) && scale >= 1) {
      setScreencastMaxEncodeScale(Math.min(2, scale))
    }
    setViewportPolicy(readSessionViewportPolicy(config))
    const nextMirrorMode = normalizeMirrorMode(config.sessions?.mirrorMode)
    if (nextMirrorMode === mirrorModeRef.current) {
      return
    }
    const surfaceLocked =
      sessionRef.current != null
      || phaseRef.current === 'starting'
      || phaseRef.current === 'live'
    if (surfaceLocked) {
      // Keep the mounted surface; next Start will pick up the new mode from cache.
      return
    }
    mirrorModeRef.current = nextMirrorMode
    setMirrorMode(nextMirrorMode)
    // Surface swap — require a fresh layout report from the definitive host.
    layoutWaiter.invalidate()
  }, [layoutWaiter, phaseRef, sessionRef])

  /** In-flight mount load, so `start` reuses it instead of racing a second fetch. */
  const clientConfigLoadRef = useRef<Promise<ClientConfig | null> | null>(null)

  const loadClientConfig = useCallback(
    async (force = false): Promise<ClientConfig | null> => {
      const load = fetchClientConfig(API_URL, force)
        .then((config) => {
          applyClientConfig(config)
          return config
        })
        .catch(() => null)
      clientConfigLoadRef.current = load
      return load
    },
    [applyClientConfig],
  )

  useEffect(() => {
    void loadClientConfig(true)
  }, [loadClientConfig])

  return {
    mirrorMode,
    mirrorModeRef,
    viewportPolicy,
    screencastMaxEncodeScale,
    clientObservation,
    observationRef,
    applyClientConfig,
    loadClientConfig,
    clientConfigLoadRef,
  }
}
