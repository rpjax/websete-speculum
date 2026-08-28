import { useEffect, useRef } from 'react'
import { API_URL } from '@/lib/env'
import { fetchClientConfig } from '@/lib/clientConfig'
import { SessionObservationChrome } from '@/features/sessions/debug/SessionObservationChrome'
import { SessionMirrorSurface } from '@/features/sessions/live/SessionMirrorSurface'
import { parseClientNavigation } from '@/features/sessions/live/sessionCoords'
import { useLiveSession } from '@/features/sessions/live/useLiveSession'
import { W7S_PREFIX, isW7sPath } from '@/lib/w7s'

const VIEWPORT = { width: 1280, height: 720 }

/**
 * Immersive live surface: same {@link useLiveSession} + {@link SessionMirrorSurface}
 * as the session lab. Front observation chrome appears when
 * Telemetry.ClientObservation is enabled (revealing UI — not always-on dock).
 */
export default function SessionLivePage() {
  const session = useLiveSession({ viewport: VIEWPORT, debug: false })
  const startedRef = useRef(false)
  const startRef = useRef(session.start)
  startRef.current = session.start

  useEffect(() => {
    if (startedRef.current) {
      return
    }
    startedRef.current = true
    void (async () => {
      try {
        const config = await fetchClientConfig(API_URL, true)
        if (!config.operational) {
          window.location.replace(`${W7S_PREFIX}/setup`)
          return
        }
      } catch {
        // Fall through to start — hub Pending config still redirects.
      }
      const { path, query } = parseClientNavigation(
        `${window.location.pathname}${window.location.search}`,
      )
      // Fail-closed: /w7s/* is the control plane (should be matched by explicit routes).
      if (isW7sPath(path)) {
        return
      }
      void startRef.current(path, query)
    })()
  }, [])

  const failed = session.phase === 'error'

  return (
    <div className="fixed inset-0 bg-neutral-950">
      <SessionMirrorSurface
        mirrorMode={session.mirrorMode}
        sessionId={session.sessionId}
        token={session.sessionToken}
        assetBaseUrl={API_URL}
        width={session.remoteViewport.width}
        height={session.remoteViewport.height}
        live={session.isLive}
        attachFrameSink={session.attachFrameSink}
        attachPageProjectionFrameSink={session.attachPageProjectionFrameSink}
        attachPageProjectionLifecycleSink={session.attachPageProjectionLifecycleSink}
        attachPageProjectionFrameEndedSink={session.attachPageProjectionFrameEndedSink}
        onInput={session.sendInput}
        onDomInput={session.sendDomInput}
        onFrameObserve={session.observePageProjectionFrameApply}
        registerApplierProbe={session.registerPageProjectionApplierProbe}
        requestRemoteResize={session.requestRemoteResize}
        viewportPolicy={session.viewportPolicy ?? undefined}
        onCanvasLayout={session.onCanvasLayout}
        onRemoteViewportApplied={session.onRemoteViewportApplied}
        touchPrimary={session.touchPrimary}
        editingActive={session.editing != null}
        keyboardNonce={session.keyboardNonce}
        deviceScaleFactor={session.deviceScaleFactor}
        maxEncodeScale={session.screencastMaxEncodeScale}
        presentation="immersive"
        className="h-full w-full"
        label="Page"
      />
      <SessionObservationChrome
        presentation="live-float"
        entries={session.entries}
        observation={session.clientObservation}
      />
      {failed ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white">
          <p className="max-w-sm px-6 text-center text-sm text-neutral-600">
            This page isn’t available right now.
          </p>
        </div>
      ) : null}
    </div>
  )
}
