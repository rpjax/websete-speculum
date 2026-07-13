export function syncClientLocation(mappedUrl: string, mirroringEnabled: boolean): void {
  try {
    const next = new URL(mappedUrl)
    const current = window.location

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
