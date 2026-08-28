import { parseClientNavigation, toClientAddressBar } from './sessionCoords'

/**
 * Projects a SyncUrl absolute URL into the client address forms used by lab
 * and live alike (same helper — no lab-only branch).
 *
 * Server reverse projection already emits a session-host URL (apex + `_w7s_nso`,
 * or mirrored host). Trust path + query for `clientHref` — do not re-encode
 * hostname into NSO (that would overwrite server state with the session host).
 *
 * History pushState is owned by {@link syncClientLocation} / the live session
 * path: Live is the catch-all default, so the operator URL mirrors the remote
 * path. Control-plane `/w7s/*` is never projected.
 */
export function applySyncedBrowserUrl(absoluteSyncedUrl: string): {
  display: string
  clientHref: string
} {
  const display = toClientAddressBar(absoluteSyncedUrl)
  const trimmed = absoluteSyncedUrl.trim()
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed)
      const path = url.pathname || '/'
      const query = url.search.startsWith('?') ? url.search.slice(1) : url.search
      return { display, clientHref: query ? `${path}?${query}` : path }
    }
  } catch {
    // fall through
  }

  const { path, query } = parseClientNavigation(absoluteSyncedUrl)
  const clientHref = query ? `${path}?${query}` : path
  return { display, clientHref }
}

/**
 * Lab address-bar → Navigate wire. Untouched synced display keeps server `_w7s_nso`;
 * an edited bar is parsed as typed input.
 */
export function resolveLabNavigateWire(input: {
  address: string
  currentUrl: string | null
  navigateHref: string | null
}): string {
  if (input.navigateHref && input.currentUrl != null && input.address === input.currentUrl) {
    return input.navigateHref
  }
  return input.address
}
