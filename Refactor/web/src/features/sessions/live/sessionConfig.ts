/** Shared session client config — same for lab and immersive live. */

const PROFILE_KEY = 'speculum.session.profileId'
/** Legacy smoke key — read once for migration, then rewrite to PROFILE_KEY. */
const LEGACY_SMOKE_PROFILE_KEY = 'speculum.smoke.profileId'
const LAB_HUB_ORIGIN_KEY = 'speculum.lab.hubOrigin'
const LAB_TRANSPORT_ORIGIN_KEY = 'speculum.lab.transportOrigin'
const LEGACY_SMOKE_HUB_KEY = 'speculum.smoke.hubOrigin'
const LEGACY_SMOKE_TRANSPORT_KEY = 'speculum.smoke.transportOrigin'

export interface SessionOrigins {
  /** Origin serving `/vhub`; empty means same-origin (dev proxy or Traefik). */
  hubOrigin: string
  /** Origin serving `/vtransport` over HTTPS + HTTP/3; empty means same-origin. */
  transportOrigin: string
}

function envValue(key: string): string {
  const raw = import.meta.env[key] as string | undefined
  return raw?.trim().replace(/\/$/, '') ?? ''
}

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function persist(key: string, value: string): void {
  try {
    if (value) {
      window.localStorage.setItem(key, value)
    } else {
      window.localStorage.removeItem(key)
    }
  } catch {
    // private mode — overrides stay in-memory only
  }
}

/** Env-only origins — production `/live` never reads lab localStorage overrides. */
export function loadEnvOrigins(): SessionOrigins {
  return {
    hubOrigin: envValue('VITE_SPECULUM_HUB_ORIGIN'),
    transportOrigin: envValue('VITE_SPECULUM_TRANSPORT_ORIGIN'),
  }
}

/**
 * Lab may override hub/transport in localStorage (Wire tab).
 * Same createSessionClient + hub RPCs; only the endpoint strings differ.
 */
export function loadLabOrigins(): SessionOrigins {
  const env = loadEnvOrigins()
  return {
    hubOrigin:
      stored(LAB_HUB_ORIGIN_KEY) ??
      stored(LEGACY_SMOKE_HUB_KEY) ??
      env.hubOrigin,
    transportOrigin:
      stored(LAB_TRANSPORT_ORIGIN_KEY) ??
      stored(LEGACY_SMOKE_TRANSPORT_KEY) ??
      env.transportOrigin,
  }
}

export function saveLabOrigins(origins: SessionOrigins): void {
  persist(LAB_HUB_ORIGIN_KEY, origins.hubOrigin.trim().replace(/\/$/, ''))
  persist(LAB_TRANSPORT_ORIGIN_KEY, origins.transportOrigin.trim().replace(/\/$/, ''))
}

/** Profile id from EnsureProfile — shared across lab and live (same persisted browser). */
export function loadProfileId(): string | null {
  const current = stored(PROFILE_KEY)
  if (current) {
    return current
  }
  const legacy = stored(LEGACY_SMOKE_PROFILE_KEY)
  if (legacy) {
    persist(PROFILE_KEY, legacy)
    return legacy
  }
  return null
}

export function saveProfileId(profileId: string): void {
  persist(PROFILE_KEY, profileId)
}

export function clearProfileId(): void {
  persist(PROFILE_KEY, '')
  persist(LEGACY_SMOKE_PROFILE_KEY, '')
}
