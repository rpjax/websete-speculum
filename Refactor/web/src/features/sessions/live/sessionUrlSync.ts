import { parseClientNavigation, toClientAddressBar } from './sessionCoords'

/**
 * Projects a SyncUrl absolute target into the client address forms used by lab
 * and live alike (same helper — no smoke-only branch).
 *
 * `clientHref` is the official path + `_w7s_nso` wire shape for Navigate/Start.
 * History pushState is intentionally not done here: the SPA still mounts live
 * only at `/live` (and lab at `/`); replacing pathname would leave that route.
 * Reverse host map + path catch-all can adopt `clientHref` for history later.
 */
export function applySyncedBrowserUrl(absoluteTargetUrl: string): {
  display: string
  clientHref: string
} {
  const display = toClientAddressBar(absoluteTargetUrl)
  const { path, query } = parseClientNavigation(absoluteTargetUrl)
  const clientHref = query ? `${path}?${query}` : path
  return { display, clientHref }
}
