import { useEffect, useRef } from 'react'
import { API_URL } from '@/lib/env'
import { fetchClientConfig } from '@/lib/clientConfig'
import { SessionViewport } from '@/features/sessions/live/SessionViewport'
import { parseClientNavigation } from '@/features/sessions/live/sessionCoords'
import { useLiveSession } from '@/features/sessions/live/useLiveSession'
import { W7S_PREFIX, isW7sPath } from '@/lib/w7s'

const VIEWPORT = { width: 1280, height: 720 }

/**
 * Immersive live surface: same {@link useLiveSession} + {@link SessionViewport}
 * as the session lab — no debug chrome, no Journal stream, no session vocabulary.
 * Default / catch-all route: browser path/query feeds StartSession as-is.
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
    <div className="fixed inset-0 bg-white">
      <SessionViewport
        width={session.remoteViewport.width}
        height={session.remoteViewport.height}
        live={session.isLive}
        attachFrameSink={session.attachFrameSink}
        onInput={session.sendInput}
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
