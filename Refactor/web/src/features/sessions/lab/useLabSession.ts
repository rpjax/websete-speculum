import {
  useLiveSession,
  type LiveSessionPhase,
  type LiveSessionStats,
  type LiveSessionViewport,
} from '@/features/sessions/live/useLiveSession'

export type LabPhase = LiveSessionPhase
export type LabStats = LiveSessionStats
export type LabViewport = LiveSessionViewport

/**
 * Lab session hook — identical application path to `/live`
 * ({@link useLiveSession}); enables debug observation + lab Wire origins only.
 */
export function useLabSession(viewport: LiveSessionViewport) {
  return useLiveSession({ viewport, debug: true, labOrigins: true })
}
