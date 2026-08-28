import { isW7sPath } from '@/lib/w7s'

/**
 * Mirror a remote browser URL into the operator address bar.
 * Skips paths under `/w7s` so SyncUrl cannot land on the Speculum control plane.
 */
export function syncClientLocation(mappedUrl: string, mirroringEnabled: boolean): void {
  try {
    const next = new URL(mappedUrl)
    const current = window.location

    if (isW7sPath(next.pathname)) {
      return
    }

    if (mirroringEnabled && next.host !== current.host) {
      window.location.href = mappedUrl
      return
    }

    if (`${current.pathname}${current.search}` !== `${next.pathname}${next.search}`) {
      window.history.pushState({}, '', `${next.pathname}${next.search}`)
    }
  } catch {
    // ignore invalid URLs
  }
}
