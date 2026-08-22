/** Lag helper for PageProjection observation (sidecar wall clock → client). */
export function pageProjectionLagMs(
  sidecarTimestamp: number | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (sidecarTimestamp == null || !Number.isFinite(sidecarTimestamp)) return null
  if (sidecarTimestamp < 1e12) return null
  return nowMs - sidecarTimestamp
}
