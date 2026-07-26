import {
  useLiveSession,
  type LiveSessionPhase,
  type LiveSessionStats,
  type LiveSessionViewport,
} from '@/features/sessions/live/useLiveSession'

export type SmokePhase = LiveSessionPhase
export type SmokeStats = LiveSessionStats
export type SmokeViewport = LiveSessionViewport

/**
 * Lab session hook — identical application path to `/live`
 * ({@link useLiveSession}); enables debug observation + lab Wire origins only.
 */
export function useSmokeSession(viewport: LiveSessionViewport) {
  return useLiveSession({ viewport, debug: true, labOrigins: true })
}
