/**
 * Stamp reserved session auth onto `/w7s/virtual-*` URLs in the Projected
 * document and owned CSSOM — mirrors V1 DomProjector / PageProjectionDiffApplier.
 * Without this, the browser fetches assets unauthenticated → mass 401 / broken imgs.
 */
import { appendSessionAuth, isVirtualAssetUrl } from '@/lib/speculum/sessionBindingAuth'
import { mapSrcset } from '../dom/srcsetParse'

const URL_ATTRS = new Set([
  'src',
  'href',
  'xlink:href',
  'poster',
  'data-src',
  'srcset',
  'imagesrcset',
])

export type VirtualAuthAppender = (url: string) => string

export function makeVirtualAuthAppender(token: string | null | undefined, assetBaseUrl?: string): VirtualAuthAppender | null {
  if (!token) return null
  return (url) => appendSessionAuth(url, token, assetBaseUrl ?? '')
}

/** Stamp auth on every `/w7s/virtual-*` url() in a stylesheet or style attribute. */
export function stampCssVirtualUrls(css: string, append: VirtualAuthAppender): string {
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, quote: string, raw: string) => {
    const url = String(raw).trim()
    if (!isVirtualAssetUrl(url)) return full
    return `url(${quote}${append(url)}${quote})`
  })
}

export function stampAttrVirtualUrl(name: string, value: string, append: VirtualAuthAppender): string {
  const lower = name.toLowerCase()
  if (lower === 'srcset' || lower === 'imagesrcset') {
    return mapSrcset(value, (u) => (isVirtualAssetUrl(u) ? append(u) : u))
  }
  if (lower === 'style') return stampCssVirtualUrls(value, append)
  if (URL_ATTRS.has(lower) && isVirtualAssetUrl(value)) return append(value)
  return value
}

/** Stamp every `/w7s/virtual-*` URL occurrence inside an HTML chunk before doc.write. */
export function stampHtmlVirtualUrls(html: string, append: VirtualAuthAppender): string {
  if (!html.includes('/w7s/virtual-')) return html
  return html.replace(/\/w7s\/virtual-[^"'>\s]*/g, (url) => {
    if (!isVirtualAssetUrl(url)) return url
    if (/[?&]speculum-session-token=/i.test(url)) return url
    return append(url)
  })
}

/** Walk the established document once and stamp every virtual URL sink. */
export function stampDocumentVirtualUrls(doc: Document, append: VirtualAuthAppender): void {
  const root = doc.documentElement
  if (!root) return
  const all = root.querySelectorAll('*')
  for (const el of all) {
    for (const name of el.getAttributeNames()) {
      const raw = el.getAttribute(name)
      if (raw == null) continue
      const next = stampAttrVirtualUrl(name, raw, append)
      if (next !== raw) {
        try {
          el.setAttribute(name, next)
        } catch {
          /* */
        }
      }
    }
  }
  for (const style of doc.querySelectorAll('style')) {
    const text = style.textContent ?? ''
    const next = stampCssVirtualUrls(text, append)
    if (next !== text) style.textContent = next
  }
}
