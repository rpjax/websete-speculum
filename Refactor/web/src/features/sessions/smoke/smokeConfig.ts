const PROFILE_KEY = 'speculum.smoke.profileId'
const HUB_ORIGIN_KEY = 'speculum.smoke.hubOrigin'
const TRANSPORT_ORIGIN_KEY = 'speculum.smoke.transportOrigin'

export interface SmokeOrigins {
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

export function loadOrigins(): SmokeOrigins {
  return {
    hubOrigin: stored(HUB_ORIGIN_KEY) ?? envValue('VITE_SPECULUM_HUB_ORIGIN'),
    transportOrigin:
      stored(TRANSPORT_ORIGIN_KEY) ?? envValue('VITE_SPECULUM_TRANSPORT_ORIGIN'),
  }
}

export function saveOrigins(origins: SmokeOrigins): void {
  persist(HUB_ORIGIN_KEY, origins.hubOrigin.trim().replace(/\/$/, ''))
  persist(TRANSPORT_ORIGIN_KEY, origins.transportOrigin.trim().replace(/\/$/, ''))
}

/** Profile id from the last EnsureProfile, so reruns reuse persisted browser state. */
export function loadProfileId(): string | null {
  return stored(PROFILE_KEY)
}

export function saveProfileId(profileId: string): void {
  persist(PROFILE_KEY, profileId)
}

export function clearProfileId(): void {
  persist(PROFILE_KEY, '')
}
