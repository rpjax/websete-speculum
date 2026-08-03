/** Shared session client config — same for lab and immersive live. */

const PROFILE_KEY = 'speculum.session.profileId'
/** Lab-only: log every sendInput to the Activity feed (client hop of input-path tracing). */
const LAB_INPUT_PATH_CLIENT_KEY = 'speculum.lab.inputPathClient'
/** Lab DEV: debug dock open (canvas split). */
const LAB_DEBUG_DOCK_KEY = 'speculum.lab.debugDock'
/** Lab DEV: last selected debug tools tab. */
const LAB_DEBUG_TAB_KEY = 'speculum.lab.debugTab'

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

/** Bake-time / env origins — hub + WT edge from deploy (`VITE_SPECULUM_*`). */
export function loadEnvOrigins(): SessionOrigins {
  return {
    hubOrigin: envValue('VITE_SPECULUM_HUB_ORIGIN'),
    transportOrigin: envValue('VITE_SPECULUM_TRANSPORT_ORIGIN'),
  }
}

/** Lab-only: log client `sendInput` as `input_path client_sent`. Off by default. */
export function loadLabInputPathClientTrace(): boolean {
  return stored(LAB_INPUT_PATH_CLIENT_KEY) === '1'
}

export function saveLabInputPathClientTrace(enabled: boolean): void {
  persist(LAB_INPUT_PATH_CLIENT_KEY, enabled ? '1' : '')
}

/** Session Lab: whether the debug tools dock is open. */
export function loadLabDebugDockOpen(): boolean {
  return stored(LAB_DEBUG_DOCK_KEY) === '1'
}

export function saveLabDebugDockOpen(open: boolean): void {
  persist(LAB_DEBUG_DOCK_KEY, open ? '1' : '')
}

const LAB_DEBUG_TABS = [
  'stream',
  'activity',
  'journal',
  'console',
  'eval',
  'config',
] as const

export type LabDebugTab = (typeof LAB_DEBUG_TABS)[number]

export function loadLabDebugTab(): LabDebugTab {
  const value = stored(LAB_DEBUG_TAB_KEY)
  return LAB_DEBUG_TABS.includes(value as LabDebugTab)
    ? (value as LabDebugTab)
    : 'journal'
}

export function saveLabDebugTab(tab: LabDebugTab): void {
  persist(LAB_DEBUG_TAB_KEY, tab)
}

/** Profile id from EnsureProfile — shared across lab and live (same persisted browser). */
export function loadProfileId(): string | null {
  return stored(PROFILE_KEY)
}

export function saveProfileId(profileId: string): void {
  persist(PROFILE_KEY, profileId)
}

export function clearProfileId(): void {
  persist(PROFILE_KEY, '')
}
