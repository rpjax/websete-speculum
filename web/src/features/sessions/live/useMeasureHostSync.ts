import { useEffect, useRef, type RefObject } from 'react'
import type { ResizeSessionResult, SessionDeviceProfile } from '@/lib/speculum'
import {
  CanvasViewportSync,
  measureCanvasElement,
  type CanvasSize,
} from './CanvasViewportSync'
import type { SessionViewportBounds } from './sessionViewportPolicy'

export interface UseMeasureHostSyncOptions {
  hostRef: RefObject<HTMLElement | null>
  live: boolean
  requestRemoteResize?: (
    size: CanvasSize,
    device: SessionDeviceProfile,
  ) => Promise<ResizeSessionResult>
  viewportPolicy?: SessionViewportBounds
  /** StartSession / confirmed remote size — seed only; never schedule on bind. */
  seedWidth: number
  seedHeight: number
  isDeferred?: () => boolean
  onApplied?: (size: CanvasSize) => void
}

/**
 * Bind {@link CanvasViewportSync} to a measure host: seedRemote + observe + dispose.
 * Never schedules a corrective resize on bind (stable screen ⇒ no Resize).
 */
export function useMeasureHostSync({
  hostRef,
  live,
  requestRemoteResize,
  viewportPolicy,
  seedWidth,
  seedHeight,
  isDeferred,
  onApplied,
}: UseMeasureHostSyncOptions): RefObject<CanvasViewportSync | null> {
  const syncRef = useRef<CanvasViewportSync | null>(null)
  const requestRef = useRef(requestRemoteResize)
  requestRef.current = requestRemoteResize
  const onAppliedRef = useRef(onApplied)
  onAppliedRef.current = onApplied
  const isDeferredRef = useRef(isDeferred)
  isDeferredRef.current = isDeferred

  useEffect(() => {
    const host = hostRef.current
    const request = requestRef.current
    if (!host || !live || !request || !viewportPolicy) {
      syncRef.current?.dispose()
      syncRef.current = null
      return
    }

    const sync = new CanvasViewportSync({
      measure: () => measureCanvasElement(host),
      resize: (size, device) => request(size, device),
      viewportPolicy,
      isDeferred: isDeferredRef.current
        ? () => isDeferredRef.current?.() ?? false
        : undefined,
      onApplied: (size) => {
        onAppliedRef.current?.(size)
      },
    })
    sync.seedRemote(seedWidth, seedHeight)
    sync.observe(host)
    syncRef.current = sync

    return () => {
      sync.dispose()
      if (syncRef.current === sync) {
        syncRef.current = null
      }
    }
    // seedWidth/seedHeight are bind-time seeds; rebinding on every remote ack
    // would churn the observer. live + policy own the sync lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [hostRef, live, viewportPolicy])

  return syncRef
}
