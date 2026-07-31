import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { API_URL } from '@/lib/env'
import { fetchClientConfig } from '@/lib/clientConfig'
import { SessionViewport } from '@/features/sessions/live/SessionViewport'
import { parseClientNavigation } from '@/features/sessions/live/sessionCoords'
import { useLiveSession } from '@/features/sessions/live/useLiveSession'

const VIEWPORT = { width: 1280, height: 720 }

/**
 * Immersive live surface: same {@link useLiveSession} + {@link SessionViewport}
 * as the session lab — no debug chrome, no lab origin overrides, no Journal stream.
 * Starts from the current browser path/query (official path+query / NSO wire).
 */
export default function SessionLivePage() {
  const session = useLiveSession({ viewport: VIEWPORT, debug: false, labOrigins: false })
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
          window.location.replace('/setup')
          return
        }
      } catch {
        // Fall through to start — hub Pending config still redirects.
      }
      const { path, query } = parseClientNavigation(
        `${window.location.pathname}${window.location.search}`,
      )
      const startPath =
        path === '/live' || path === '/' || path === '/lab' ? '/' : path
      void startRef.current(startPath, query)
    })()
  }, [])

  return (
    <div className="fixed inset-0 bg-background">
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
        className="h-full w-full"
        label="Live session"
      />
      {!session.isLive && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-md bg-background/90 px-4 py-3 text-sm text-muted-foreground">
            {PHASE_HINT[session.phase] ?? 'Connecting…'}
          </p>
        </div>
      )}
      {session.isLive && session.touchPrimary && (
        <Button
          type="button"
          size="sm"
          className="absolute bottom-4 right-4 shadow"
          onClick={() => session.openKeyboard()}
        >
          Keyboard
        </Button>
      )}
    </div>
  )
}

const PHASE_HINT: Record<string, string> = {
  connecting: 'Connecting hub…',
  connected: 'Starting session…',
  starting: 'Starting session…',
  stopping: 'Stopping…',
  idle: 'Connecting…',
}
