import { diagnosticsApi } from '@/lib/diagnosticsApi'

const POLL_MS = 250
const DEFAULT_TIMEOUT_MS = 5_000

/**
 * Poll Diagnostics.ConfigApplied events emitted at-or-after `sinceIso`.
 * Returns true when an event is observed; false on timeout.
 */
export async function waitConfigApplied(
  sinceIso: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const sinceMs = new Date(sinceIso).getTime()

  while (Date.now() < deadline) {
    try {
      const events = await diagnosticsApi.listEvents({
        since: sinceIso,
        namePrefix: 'Diagnostics.ConfigApplied',
      })
      const hit = events.some((e) => new Date(e.utc).getTime() >= sinceMs - 1_000)
      if (hit) return true
    } catch {
      // Keep polling — transient fetch errors should not abort confirmation.
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  return false
}
