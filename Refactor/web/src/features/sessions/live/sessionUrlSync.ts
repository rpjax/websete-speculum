import { parseClientNavigation, toClientAddressBar } from './sessionCoords'

/**
 * Projects a SyncUrl absolute target into the client address forms used by lab
 * and live alike (same helper — no lab-only branch).
 *
 * `clientHref` is the official path + `_w7s_nso` wire shape for Navigate/Start.
 * History pushState is intentionally not done here: the SPA still mounts live
 * at `/` (prod) / `/live` (and lab at `/lab` or DEV `/`); replacing pathname would
 * leave that route. Reverse host map + path catch-all can adopt `clientHref` later.
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
